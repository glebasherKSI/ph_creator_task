/** Страница «Редактор задач»: домен → список задач → форма (копия / правка) и статистика. */
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthModal";
import { StatsPanel } from "@/features/stats/StatsPanel";
import { useStatsReport } from "@/features/stats/useStatsReport";
import { TaskForm } from "@/features/task-form/TaskForm";
import type { TaskFormMode } from "@/features/task-form/task-form";
import { createTask, fetchTask, updateTask } from "@/lib/task-api";
import type { GamificationTask, TaskPayloadEnvelope } from "@/lib/types";
import { cn } from "@/lib/utils";

import { TaskList } from "./TaskList";
import { useDomainList } from "./useDomainList";
import { useTaskList } from "./useTaskList";

type MainView = "editor" | "stats";

/** Страница канвы появится на этапе 7. */
const CHAINS_PAGE = "/showcase.html";

export function EditorPage() {
  const { domains, domain, setDomain, loaded } = useDomainList();
  const auth = useAuth();
  const list = useTaskList();
  const [activeId, setActiveId] = useState<number | string | null>(null);
  const [mode, setMode] = useState<TaskFormMode>("copy");
  const [view, setView] = useState<MainView>("editor");
  const [taskOnly, setTaskOnly] = useState(false);
  const [status, setStatus] = useState<{ text: string; error: boolean }>({
    text: "Выберите домен и загрузите задачи",
    error: false,
  });
  const report = useStatsReport(domain);

  const detail = useQuery({
    queryKey: ["task", domain, activeId],
    queryFn: () => fetchTask(domain, activeId!),
    enabled: Boolean(domain && activeId != null),
    staleTime: 60_000,
  });

  const activeTask = list.tasks.find((t) => String(t.id) === String(activeId)) ?? null;
  const taskOptions = list.tasks.map((t) => ({ id: String(t.id), name: String(t.name ?? "") }));

  function say(text: string, error = false) {
    setStatus({ text, error });
  }

  async function loadTasks(reset: boolean) {
    if (!domain) {
      say("Нет сохранённых доменов. Добавьте админку в popup.", true);
      return;
    }
    const ok = await auth.ensureAuthenticated(domain, {
      message: `Для загрузки задач нужен вход в ${domain}`,
    });
    if (!ok) {
      say("Вход не выполнен — список задач недоступен", true);
      return;
    }
    say("Загружаю список задач...");
    try {
      await list.load(domain, reset);
      say(`Загружено задач с ${domain}`);
    } catch (err) {
      say(`Ошибка загрузки списка: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  async function submit(payload: TaskPayloadEnvelope): Promise<unknown> {
    if (mode === "edit" && activeId != null) {
      const { response, task } = await updateTask(domain, activeId, payload);
      if (task) list.upsert(task);
      await detail.refetch();
      toast.success(`Задача #${activeId} сохранена`);
      say(`Задача #${activeId} сохранена`);
      return response;
    }
    const { response, newId, task } = await createTask(domain, payload);
    if (!newId) {
      say("Задача создана, но id не найден — нажмите «Загрузить задачи»", true);
      toast.warning("Задача создана, но id не найден");
      return response;
    }
    if (task) list.upsert(task);
    toast.success(`Копия создана — #${newId}`);
    say(`Копия создана, новая задача #${newId}`);
    return response;
  }

  function openChains() {
    void browser.tabs.create({ url: browser.runtime.getURL(CHAINS_PAGE) });
  }

  const sourceTask: GamificationTask | null = detail.data ?? null;

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3">
        <h1 className="text-title-2">Редактор задач PromoHub</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SimpleSelect
            value={domain}
            onValueChange={setDomain}
            options={domains.map((d) => ({ value: d, label: d }))}
            placeholder={loaded ? "Нет доменов" : "Загрузка…"}
            disabled={!domains.length}
            size="sm"
            className="w-72 font-mono"
            aria-label="Домен админки"
          />
          <Button variant="secondary" size="sm" onClick={openChains}>
            Конструктор связей
          </Button>
        </div>
        <p
          role="status"
          className={cn(
            "basis-full text-caption",
            status.error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status.text}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <TaskList
          list={list}
          activeId={activeId}
          onSelect={(task) => setActiveId(task.id)}
          onLoad={() => void loadTasks(true)}
          onLoadMore={() => void loadTasks(false)}
          disabled={!domain}
        />

        <main className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg bg-background p-4 ring-1 ring-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<MainView>
              value={view}
              onValueChange={(next) => {
                setView(next);
                if (next === "stats") {
                  void report.loadProjects();
                  if (!report.rows.length && !report.loading) report.reload(0);
                }
              }}
              options={[
                { value: "editor", label: "Редактор" },
                { value: "stats", label: "Статистика" },
              ]}
              aria-label="Раздел"
            />
            {view === "editor" ? (
              <div className="flex items-center gap-3">
                {detail.isFetching ? (
                  <span className="flex items-center gap-1 text-caption text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> задача #{activeId}
                  </span>
                ) : null}
                <Segmented<TaskFormMode>
                  size="sm"
                  value={mode}
                  onValueChange={setMode}
                  options={[
                    { value: "copy", label: "Копия" },
                    { value: "edit", label: "Правка" },
                  ]}
                  aria-label="Режим"
                />
              </div>
            ) : null}
          </div>

          {view === "editor" ? (
            detail.error ? (
              <p className="text-subhead text-destructive">
                Не удалось загрузить задачу: {(detail.error as Error).message}
              </p>
            ) : (
              <TaskForm
                key={`${mode}:${activeId ?? "none"}`}
                mode={mode}
                domain={domain}
                sourceTask={sourceTask}
                taskOptions={taskOptions}
                onSubmit={submit}
              />
            )
          ) : (
            <StatsPanel
              report={report}
              activeTask={
                activeTask ? { id: activeTask.id, name: String(activeTask.name ?? "") } : null
              }
              taskOnly={taskOnly}
              onTaskOnlyChange={setTaskOnly}
            />
          )}
        </main>
      </div>
    </div>
  );
}
