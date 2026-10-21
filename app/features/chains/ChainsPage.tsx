/** Страница «Конструктор связей»: домен → каталог → канва React Flow → панель связи и форма задачи. */
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { BookmarkPlus, FolderOpen, Loader2, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { useAuth } from "@/features/auth/AuthModal";
import { useDomainList } from "@/features/editor/useDomainList";
import { StatsPanel } from "@/features/stats/StatsPanel";
import { useStatsReport } from "@/features/stats/useStatsReport";
import { cn } from "@/lib/utils";

import { detectBlockConflicts, formatConflictsCounter, useBlockCheck } from "./block-check";
import { useAddLabel } from "./CanvasLabels";
import { CatalogSidebar } from "./CatalogSidebar";
import { EdgePanel } from "./EdgePanel";
import { FlowCanvas } from "./FlowCanvas";
import { useLabelsStore } from "./labels-store";
import { PackagesPanel } from "./PackagesPanel";
import { SelectionToolbar } from "./SelectionToolbar";
import { type SaveLogEntry, useChainsStore } from "./store";
import { TaskSheet } from "./TaskSheet";
import { TemplatesDialogs, useLoadTemplateDialog, useSaveTemplateDialog } from "./TemplatesDialogs";

function SaveLog({ entries, onClose }: { entries: SaveLogEntry[]; onClose: () => void }) {
  const tone: Record<SaveLogEntry["kind"], string> = {
    pending: "text-muted-foreground",
    ok: "text-success",
    err: "text-destructive",
  };
  return (
    <div
      role="log"
      aria-label="Журнал сохранения"
      className="absolute right-3 bottom-3 z-10 flex max-h-64 w-80 flex-col rounded-lg bg-surface shadow-2xl ring-1 ring-border"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-subhead font-medium">Сохранение</span>
        <Button variant="ghost" size="icon-sm" aria-label="Закрыть журнал" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-caption">
        {entries.map((entry) => (
          <li key={entry.id} className={tone[entry.kind]}>
            {entry.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

type MainView = "canvas" | "stats" | "packages";

function ChainsPageInner() {
  const { domains, domain, setDomain, loaded } = useDomainList();
  const auth = useAuth();
  const rf = useReactFlow();
  const [logOpen, setLogOpen] = useState(false);
  const [view, setView] = useState<MainView>("canvas");
  const [taskOnly, setTaskOnly] = useState(false);
  const report = useStatsReport(domain);
  const selectedTask = useChainsStore((s) =>
    s.selectedTaskId ? (s.canvas[s.selectedTaskId] ?? null) : null,
  );

  const status = useChainsStore((s) => s.status);
  const setStatus = useChainsStore((s) => s.setStatus);
  const catalogLoading = useChainsStore((s) => s.catalogLoading);
  const catalogHasMore = useChainsStore((s) => s.catalogHasMore);
  const catalogSize = useChainsStore((s) => s.catalogOrder.length);
  const canvasSize = useChainsStore((s) => Object.keys(s.canvas).length);
  const dirtyCount = useChainsStore((s) => s.dirtyTargets.length);
  const saving = useChainsStore((s) => s.saving);
  const saveLog = useChainsStore((s) => s.saveLog);
  const selectedEdge = useChainsStore((s) => s.selectedEdge);
  const addLabel = useAddLabel();
  const checkBlocks = useBlockCheck((s) => s.enabled);
  const setCheckBlocks = useBlockCheck((s) => s.setEnabled);
  const graph = useChainsStore(
    useShallow((s) => ({
      canvas: s.canvas,
      edges: s.edges,
      targetConfigs: s.targetConfigs,
      dirtyTargets: s.dirtyTargets,
    })),
  );
  const blockConflicts = useMemo(
    () => (checkBlocks ? detectBlockConflicts(graph).conflicts : []),
    [checkBlocks, graph],
  );

  // Домен из popup/localStorage → store (сбрасывает канву и каталог); подписи — тоже.
  useEffect(() => {
    void useChainsStore.getState().setDomain(domain);
    useLabelsStore.getState().clear();
  }, [domain]);

  function fit(ids?: string[]) {
    void rf.fitView({
      padding: ids ? 0.5 : 0.2,
      maxZoom: 1,
      duration: 300,
      ...(ids ? { nodes: ids.map((id) => ({ id })) } : {}),
    });
  }

  async function loadTasks(reset: boolean) {
    if (!domain) {
      setStatus("Нет сохранённых доменов. Добавьте админку в popup.", true);
      return;
    }
    const ok = await auth.ensureAuthenticated(domain, {
      message: `Для загрузки задач нужен вход в ${domain}`,
    });
    if (!ok) {
      setStatus("Вход не выполнен — список задач недоступен", true);
      return;
    }
    setStatus("Загружаю список задач...");
    try {
      await useChainsStore.getState().loadCatalog(reset);
      const size = useChainsStore.getState().catalogOrder.length;
      setStatus(`Загружено задач с ${domain}: ${size}`);
    } catch (err) {
      setStatus(
        `Ошибка загрузки списка: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
  }

  async function addToCanvas(ids: string[]) {
    setStatus(`Добавляю на канву: ${ids.length}…`);
    try {
      await useChainsStore.getState().addToCanvas(ids);
      setStatus(`На канве ${Object.keys(useChainsStore.getState().canvas).length} задач`);
      // Новые ноды измеряются после рендера — вписываем чуть позже.
      window.setTimeout(() => fit(), 50);
    } catch (err) {
      setStatus(`Не удалось добавить: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function focusNode(id: string) {
    useChainsStore.getState().select(id);
    fit([id]);
  }

  function align() {
    const store = useChainsStore.getState();
    // Реальные высоты карточек из React Flow, чтобы колонки не наезжали.
    const heights: Record<string, number> = {};
    for (const node of rf.getNodes()) {
      if (node.measured?.height) heights[node.id] = node.measured.height;
    }
    store.autoLayout({ forceAll: true, heights });
    setStatus(`Раскладка пересчитана для ${Object.keys(store.canvas).length} задач`);
    window.setTimeout(() => fit(), 50);
  }

  async function save() {
    setLogOpen(true);
    const { ok, err } = await useChainsStore.getState().saveChanges();
    setStatus(err ? `Сохранено ${ok}, ошибок ${err}` : `Сохранено ${ok} задач`, err > 0);
  }

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-3">
        <h1 className="text-title-2">Конструктор связей</h1>
        <Segmented<MainView>
          size="sm"
          value={view}
          onValueChange={(next) => {
            setView(next);
            if (next === "stats") {
              void report.loadProjects();
              if (!report.rows.length && !report.loading) report.reload(0);
            }
          }}
          options={[
            { value: "canvas", label: "Канва" },
            { value: "stats", label: "Статистика" },
            { value: "packages", label: "Пакеты" },
          ]}
          aria-label="Раздел"
        />
        <SimpleSelect
          value={domain}
          onValueChange={setDomain}
          options={domains.map((d) => ({ value: d, label: d }))}
          placeholder={loaded ? "Нет доменов" : "Загрузка…"}
          disabled={!domains.length}
          size="sm"
          className="w-64 font-mono"
          aria-label="Домен админки"
        />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!domain || catalogLoading}
            onClick={() => void loadTasks(true)}
          >
            {catalogLoading ? <Loader2 className="animate-spin" /> : null}
            Загрузить задачи
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!catalogHasMore || catalogLoading}
            onClick={() => void loadTasks(false)}
          >
            Загрузить ещё
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-caption text-muted-foreground tabular-nums">
            {catalogSize} задач · на канве {canvasSize}
          </span>
          <SelectionToolbar />
          <SwitchField
            label="Проверить блоки"
            checked={checkBlocks}
            onCheckedChange={setCheckBlocks}
            title="Подсветить параллельные задачи с кнопкой «Согласие игрока» и одинаковым целевым действием"
          />
          {checkBlocks ? (
            <span
              className={cn(
                "text-caption tabular-nums",
                blockConflicts.length ? "text-destructive" : "text-muted-foreground",
              )}
              title={
                blockConflicts.length
                  ? blockConflicts.map((c) => c.tooltip).join("\n")
                  : "Число групп с блокирующим конфликтом на канве"
              }
            >
              {formatConflictsCounter(blockConflicts.length)}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            title="Добавить подпись на канву"
            onClick={() => addLabel()}
          >
            <Tag /> Подпись
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canvasSize}
            title="Сохранить раскладку канвы как шаблон"
            onClick={() => useSaveTemplateDialog.getState().show()}
          >
            <BookmarkPlus /> Сохранить шаблон
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!domain}
            title="Загрузить сохранённый шаблон канвы"
            onClick={() => useLoadTemplateDialog.getState().show()}
          >
            <FolderOpen /> Загрузить шаблон
          </Button>
          <Button variant="secondary" size="sm" disabled={!canvasSize} onClick={align}>
            Выровнять
          </Button>
          <Button variant="secondary" size="sm" disabled={!canvasSize} onClick={() => fit()}>
            Вписать
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirtyCount || saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            Сохранить{dirtyCount ? ` (${dirtyCount})` : ""}
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

      {/* Канва всегда смонтирована: переключение вкладок не теряет viewport и выделение. */}
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3",
          view !== "canvas" && "hidden",
          selectedEdge ? "grid-cols-[22rem_minmax(0,1fr)_auto]" : "grid-cols-[22rem_minmax(0,1fr)]",
        )}
      >
        <CatalogSidebar onAdd={addToCanvas} onFocusNode={focusNode} />
        <div className="relative min-h-0">
          <FlowCanvas />
          {logOpen && saveLog.length ? (
            <SaveLog entries={saveLog} onClose={() => setLogOpen(false)} />
          ) : null}
        </div>
        {selectedEdge ? <EdgePanel /> : null}
      </div>
      {view === "stats" ? (
        <main className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-background p-4 ring-1 ring-border">
          <StatsPanel
            report={report}
            activeTask={selectedTask ? { id: selectedTask.id, name: selectedTask.name } : null}
            taskOnly={taskOnly}
            onTaskOnlyChange={setTaskOnly}
          />
        </main>
      ) : null}
      {view === "packages" ? (
        <main className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-background p-4 ring-1 ring-border">
          <PackagesPanel
            onOpened={() => {
              setView("canvas");
              window.setTimeout(() => fit(), 50);
            }}
          />
        </main>
      ) : null}

      <TaskSheet />
      <TemplatesDialogs domains={domains} />
    </div>
  );
}

export function ChainsPage() {
  return (
    <ReactFlowProvider>
      <ChainsPageInner />
    </ReactFlowProvider>
  );
}
