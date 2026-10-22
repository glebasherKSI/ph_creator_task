/**
 * Диалог «Отправить в пакет»: форма (проект графика → существующий или новый пакет → режим
 * для уже отправленных задач) → прогресс по этапам → итог с цифрами и списком проблем.
 * Открывается контроллером `useSendToPackageDialog`; пока идёт отправка, не закрывается.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleDashed, CircleX, Loader2, Minus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { useGraphic } from "@/features/popup/useGraphic";
import { getGraphicProjectForDomain } from "@/lib/storage";
import { cn } from "@/lib/utils";

import {
  type ImportMode,
  type NewPackageInput,
  type PackageTarget,
  type SendProgress,
  type SendToPackageResult,
  type TaskSendRow,
  type TaskSendState,
  countRows,
  loadGraphicProjects,
  loadProjectPackages,
  sendPercent,
  sendTasksToPackage,
} from "./package-export";
import { formatPackageDates, packageKindLabel } from "./packages";
import { useChainsStore } from "./store";

interface SendDialogState {
  open: boolean;
  seq: number;
  taskIds: string[];
  /** Идёт отправка — окно не закрывается ни крестиком, ни Esc. */
  busy: boolean;
  show: (taskIds: string[]) => void;
  close: () => void;
  setBusy: (busy: boolean) => void;
}

export const useSendToPackageDialog = create<SendDialogState>((set, get) => ({
  open: false,
  seq: 0,
  taskIds: [],
  busy: false,
  show: (taskIds) =>
    set((s) => ({ open: true, seq: s.seq + 1, busy: false, taskIds: [...new Set(taskIds)] })),
  close: () => {
    if (!get().busy) set({ open: false });
  },
  setBusy: (busy) => set({ busy }),
}));

interface SendRequest {
  projectCode: string;
  target: PackageTarget;
  mode: ImportMode;
  /** Название нового пакета или выбранного — для заголовков прогресса. */
  packageName: string;
}

type TargetMode = "existing" | "new";

const PROJECTS_KEY = "graphic-projects";
const PACKAGES_KEY = "graphic-project-packages";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function SendToPackageForm({
  taskIds,
  onClose,
  onSend,
}: {
  taskIds: string[];
  onClose: () => void;
  onSend: (request: SendRequest) => void;
}) {
  const domain = useChainsStore((s) => s.domain);
  const draftCount = useChainsStore((s) => taskIds.filter((id) => s.canvas[id]?.localOnly).length);
  const [project, setProject] = useState("");
  const [target, setTarget] = useState<TargetMode>("existing");
  const [packageId, setPackageId] = useState("");
  const [draft, setDraft] = useState<NewPackageInput>({ name: "", kind: "seasonal" });
  const [mode, setMode] = useState<ImportMode>("update");

  const projects = useQuery({ queryKey: [PROJECTS_KEY], queryFn: loadGraphicProjects });
  const packages = useQuery({
    queryKey: [PACKAGES_KEY, project],
    queryFn: () => loadProjectPackages(project),
    enabled: !!project,
  });

  // Проект, в который отправляли с этого домена в прошлый раз.
  useEffect(() => {
    let alive = true;
    void getGraphicProjectForDomain(domain).then((code) => {
      if (alive && code) setProject((current) => current || code);
    });
    return () => {
      alive = false;
    };
  }, [domain]);

  const packageList = packages.data ?? [];
  const effectiveTarget: TargetMode = packages.isSuccess && !packageList.length ? "new" : target;
  const sendCount = taskIds.length - draftCount;

  async function submit() {
    if (!project) {
      toast.warning("Выберите проект в графике");
      return;
    }
    if (effectiveTarget === "existing" && !packageId) {
      toast.warning("Выберите пакет");
      return;
    }
    if (effectiveTarget === "new" && !draft.name.trim()) {
      toast.warning("Введите название пакета");
      return;
    }
    const picked = packageList.find((pkg) => String(pkg.id) === packageId);
    onSend({
      projectCode: project,
      target: effectiveTarget === "existing" ? { packageId } : { create: draft },
      mode,
      packageName:
        effectiveTarget === "existing" ? (picked?.name ?? `#${packageId}`) : draft.name.trim(),
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-subhead text-foreground">
        Задач: {sendCount}
        {draftCount ? (
          <span className="text-muted-foreground">
            {" "}
            · черновиков {draftCount} — не отправятся, сначала создайте их на бэке
          </span>
        ) : null}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label>Проект в графике</Label>
        <SimpleSelect
          value={project}
          onValueChange={(code) => {
            setProject(code);
            setPackageId("");
          }}
          options={(projects.data ?? []).map((p) => ({
            value: p.code,
            label: `${p.display_name} (${p.code})`,
          }))}
          placeholder={projects.isLoading ? "Загружаю проекты…" : "— Выберите проект —"}
          disabled={!projects.data?.length}
          aria-label="Проект в графике"
        />
        {projects.error ? (
          <p className="text-caption text-destructive">{errorText(projects.error)}</p>
        ) : null}
      </div>

      {project ? (
        <div className="flex flex-col gap-1.5">
          <Label>Пакет</Label>
          <Segmented<TargetMode>
            size="sm"
            value={effectiveTarget}
            onValueChange={setTarget}
            options={[
              { value: "existing", label: "Существующий" },
              { value: "new", label: "Новый пакет" },
            ]}
            aria-label="Куда отправить"
          />
          {effectiveTarget === "existing" ? (
            <SimpleSelect
              value={packageId}
              onValueChange={setPackageId}
              options={packageList.map((pkg) => ({
                value: String(pkg.id),
                label: `${pkg.name ?? `#${pkg.id}`} · ${packageKindLabel(pkg.kind)} · ${formatPackageDates(pkg)}`,
              }))}
              placeholder={packages.isLoading ? "Загружаю пакеты…" : "— Выберите пакет —"}
              disabled={!packageList.length}
              aria-label="Пакет"
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Название пакета, например «Сезон 8»"
                maxLength={255}
                autoComplete="off"
                aria-label="Название пакета"
              />
              <Segmented<NewPackageInput["kind"]>
                size="sm"
                value={draft.kind}
                onValueChange={(kind) => setDraft({ ...draft, kind })}
                options={[
                  { value: "seasonal", label: "Сезонный" },
                  { value: "permanent", label: "Постоянный" },
                ]}
                aria-label="Тип пакета"
              />
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={draft.available_from ?? ""}
                  onChange={(e) => setDraft({ ...draft, available_from: e.target.value || null })}
                  aria-label="Доступен с"
                  title="Доступен с"
                />
                <Input
                  type="date"
                  value={draft.available_till ?? ""}
                  onChange={(e) => setDraft({ ...draft, available_till: e.target.value || null })}
                  aria-label="Доступен до"
                  title="Доступен до"
                />
              </div>
              {draft.kind === "seasonal" ? (
                <p className="text-caption text-muted-foreground">
                  В сезонном пакете граф дописывает название пакета к названию задания.
                </p>
              ) : null}
            </div>
          )}
          {packages.error ? (
            <p className="text-caption text-destructive">{errorText(packages.error)}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Если задача уже есть в графике</Label>
        <Segmented<ImportMode>
          size="sm"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "update", label: "Обновить" },
            { value: "skip", label: "Пропустить" },
          ]}
          aria-label="Уже отправленные задачи"
        />
        <p className="text-caption text-muted-foreground">
          Задача ищется по id на бэке во всём проекте. «Обновить» переносит её в выбранный пакет,
          если она лежит в другом; описания из графика не трогаются.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={!sendCount || !project}>
          Отправить {sendCount ? `(${sendCount})` : ""}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Список задач со статусами
// ---------------------------------------------------------------------------

const STATE_LABEL: Record<TaskSendState, string> = {
  queued: "в очереди",
  loading: "загружаю…",
  ready: "готова",
  sending: "отправляю…",
  created: "создано",
  updated: "обновлено",
  skipped: "пропущено",
  error: "ошибка",
  draft: "черновик",
};

function RowIcon({ row }: { row: TaskSendRow }) {
  const box = "flex size-5 shrink-0 items-center justify-center rounded-full";
  switch (row.state) {
    case "loading":
    case "sending":
      return (
        <span className={box}>
          <Loader2 className="size-4 animate-spin text-primary" />
        </span>
      );
    case "created":
    case "updated":
      return (
        <span
          className={cn(
            box,
            "animate-pop-in",
            row.warning ? "bg-primary/15 text-primary" : "bg-success/15 text-success",
          )}
        >
          {row.warning ? <AlertTriangle className="size-3" /> : <Check className="size-3" />}
        </span>
      );
    case "error":
      return (
        <span className={cn(box, "animate-pop-in bg-destructive/15 text-destructive")}>
          <X className="size-3" />
        </span>
      );
    case "ready":
      return (
        <span className={cn(box, "text-muted-foreground")}>
          <Check className="size-3.5" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(box, "text-muted-foreground")}>
          <Minus className="size-3.5" />
        </span>
      );
    case "draft":
      return (
        <span className={cn(box, "text-muted-foreground")}>
          <CircleDashed className="size-3.5" />
        </span>
      );
    default:
      return (
        <span className={box}>
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        </span>
      );
  }
}

function TaskRows({ rows, follow }: { rows: TaskSendRow[]; follow?: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeIndex = follow
    ? rows.findIndex((row) => row.state === "loading" || row.state === "sending")
    : -1;

  // Держим в поле зрения задачу, над которой идёт работа.
  useEffect(() => {
    if (activeIndex < 0) return;
    const item = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  if (!rows.length) {
    return (
      <p className="rounded-md bg-surface-2 p-3 text-center text-caption text-muted-foreground ring-1 ring-border">
        Нет задач
      </p>
    );
  }
  return (
    <ul
      ref={listRef}
      aria-label="Задачи"
      className="flex max-h-64 flex-col overflow-y-auto rounded-md bg-surface-2 p-1 ring-1 ring-border"
    >
      {rows.map((row) => (
        <li
          key={row.id}
          className={cn(
            "flex items-start gap-2 rounded-chip px-2 py-1.5 transition-colors duration-300",
            (row.state === "loading" || row.state === "sending") && "bg-primary/10",
          )}
        >
          <RowIcon row={row} />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-subhead",
                  row.state === "queued" ? "text-muted-foreground" : "text-foreground",
                )}
                title={row.name}
              >
                {row.name}
              </span>
              <span
                className={cn(
                  "shrink-0 text-caption tabular-nums",
                  row.state === "error"
                    ? "text-destructive"
                    : row.state === "created" || row.state === "updated"
                      ? "text-success"
                      : "text-muted-foreground",
                )}
              >
                {STATE_LABEL[row.state]}
              </span>
            </div>
            {row.detail && (row.state === "error" || row.warning || row.state === "draft") ? (
              <span
                className={cn(
                  "text-caption break-words",
                  row.state === "error" ? "text-destructive/90" : "text-muted-foreground",
                )}
              >
                {row.detail}
              </span>
            ) : null}
            {row.place ? (
              <span className="text-caption break-words text-muted-foreground">{row.place}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Прогресс
// ---------------------------------------------------------------------------

function StageChip({ label, state }: { label: string; state: "todo" | "active" | "done" }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium transition-colors duration-300",
        state === "done" && "bg-success/15 text-success",
        state === "active" && "bg-primary/15 text-primary",
        state === "todo" && "bg-surface-2 text-muted-foreground",
      )}
    >
      {state === "done" ? (
        <Check className="size-3" />
      ) : state === "active" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : null}
      {label}
    </span>
  );
}

function SendProgressView({ progress, request }: { progress: SendProgress; request: SendRequest }) {
  const counts = countRows(progress.rows);
  const percent = sendPercent(progress.rows);
  const order: SendProgress["stage"][] =
    "create" in request.target ? ["load", "package", "import"] : ["load", "import"];
  const current = order.indexOf(progress.stage);
  const stageState = (stage: SendProgress["stage"]) => {
    const index = order.indexOf(stage);
    return index < current ? "done" : index === current ? "active" : "todo";
  };
  const sent = counts.created + counts.updated + counts.skipped;
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-col gap-2"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Отправка в пакет"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-headline">
            {request.packageName ? `Пакет «${request.packageName}»` : "Отправка в пакет"}
          </span>
          <span className="text-title-2 font-semibold text-primary tabular-nums">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StageChip
          label={`Загрузка · ${counts.loaded}/${counts.total}`}
          state={stageState("load")}
        />
        {"create" in request.target ? (
          <StageChip label="Создание пакета" state={stageState("package")} />
        ) : null}
        <StageChip
          label={`Отправка · ${counts.finished}/${counts.total}`}
          state={stageState("import")}
        />
        <span className="ml-auto text-caption text-muted-foreground tabular-nums">
          {sent ? <span className="text-success">готово {sent}</span> : null}
          {counts.errors ? (
            <span className="text-destructive">
              {sent ? " · " : ""}ошибок {counts.errors}
            </span>
          ) : null}
        </span>
      </div>

      <TaskRows rows={progress.rows} follow />

      <p className="text-caption text-muted-foreground">Не закрывайте окно, пока идёт отправка.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Итог
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "muted" | "error";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-border">
      <span
        className={cn(
          "text-title-2 font-semibold tabular-nums",
          value > 0 && tone === "ok" && "text-success",
          value > 0 && tone === "error" && "text-destructive",
        )}
      >
        {value}
      </span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

type RowFilter = "problems" | "all";

function isProblem(row: TaskSendRow): boolean {
  return row.state === "error" || row.state === "draft" || row.warning === true;
}

function SendResultView({
  result,
  projectCode,
  onDone,
}: {
  result: SendToPackageResult;
  projectCode: string;
  onDone: () => void;
}) {
  const counts = countRows(result.rows);
  const problems = result.rows.filter(isProblem);
  const [filter, setFilter] = useState<RowFilter>(problems.length ? "problems" : "all");
  const clean = !problems.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 animate-pop-in items-center justify-center rounded-full",
            clean ? "bg-success/15 text-success" : "bg-primary/15 text-primary",
          )}
        >
          {clean ? <Check className="size-6" /> : <AlertTriangle className="size-5" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-headline">
            {clean ? "Готово" : "Готово с замечаниями"} · «{result.packageName}»
          </div>
          <div className="text-caption text-muted-foreground">
            Проект {projectCode} в Promo Graphic
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <StatTile label="Создано" value={counts.created} tone="ok" />
        <StatTile label="Обновлено" value={counts.updated} tone="ok" />
        <StatTile label="Пропущено" value={counts.skipped} tone="muted" />
        <StatTile label="Ошибки" value={counts.errors} tone="error" />
      </div>

      {counts.moved ? (
        <p className="text-caption text-muted-foreground">
          {counts.moved} из обновлённых лежали в других пакетах проекта — перенесены в этот.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Segmented<RowFilter>
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "problems", label: `Проблемы · ${problems.length}` },
            { value: "all", label: `Все задачи · ${result.rows.length}` },
          ]}
          aria-label="Какие задачи показать"
        />
        <TaskRows rows={filter === "problems" ? problems : result.rows} />
      </div>

      <DialogFooter>
        <Button variant="primary" onClick={onDone} autoFocus>
          Готово
        </Button>
      </DialogFooter>
    </div>
  );
}

function SendErrorView({
  message,
  rows,
  onBack,
  onClose,
}: {
  message: string;
  rows: TaskSendRow[];
  onBack: () => void;
  onClose: () => void;
}) {
  const problems = rows.filter(isProblem);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <CircleX className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-headline">Не удалось отправить</span>
          <span className="text-caption break-words whitespace-pre-line text-muted-foreground">
            {message}
          </span>
        </div>
      </div>
      {problems.length ? <TaskRows rows={problems} /> : null}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
        <Button variant="primary" onClick={onBack} autoFocus>
          Назад к настройкам
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Поток: форма → прогресс → итог / ошибка
// ---------------------------------------------------------------------------

type Phase =
  | { kind: "form" }
  | { kind: "running"; request: SendRequest; progress: SendProgress }
  | { kind: "done"; request: SendRequest; result: SendToPackageResult }
  | { kind: "error"; message: string; rows: TaskSendRow[] };

function SendFlow({ taskIds, onClose }: { taskIds: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  async function send(request: SendRequest) {
    const dialog = useSendToPackageDialog.getState();
    const store = useChainsStore.getState();
    let lastRows: TaskSendRow[] = [];
    dialog.setBusy(true);
    setPhase({ kind: "running", request, progress: { stage: "load", rows: [] } });
    store.setStatus("Отправляю задачи в пакет графика…");
    try {
      const result = await sendTasksToPackage({
        taskIds,
        projectCode: request.projectCode,
        target: request.target,
        mode: request.mode,
        onProgress: (progress) => {
          lastRows = progress.rows;
          setPhase((prev) => (prev.kind === "running" ? { ...prev, progress } : prev));
        },
      });
      setPhase({ kind: "done", request, result });
      store.setStatus(`Отправлено в пакет «${result.packageName}»`);
      void queryClient.invalidateQueries({ queryKey: [PACKAGES_KEY] });
    } catch (err) {
      const message = errorText(err);
      setPhase({ kind: "error", message, rows: lastRows });
      store.setStatus(`Не удалось отправить в пакет: ${message}`, true);
    } finally {
      dialog.setBusy(false);
    }
  }

  return (
    <>
      {/* Форма не размонтируется: «Назад к настройкам» возвращает введённое. */}
      <div className={phase.kind === "form" ? undefined : "hidden"}>
        <SendToPackageForm
          taskIds={taskIds}
          onClose={onClose}
          onSend={(request) => void send(request)}
        />
      </div>
      {phase.kind === "running" ? (
        <SendProgressView progress={phase.progress} request={phase.request} />
      ) : null}
      {phase.kind === "done" ? (
        <SendResultView
          result={phase.result}
          projectCode={phase.request.projectCode}
          onDone={onClose}
        />
      ) : null}
      {phase.kind === "error" ? (
        <SendErrorView
          message={phase.message}
          rows={phase.rows}
          onBack={() => setPhase({ kind: "form" })}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}

export function SendToPackageDialog() {
  const open = useSendToPackageDialog((s) => s.open);
  const seq = useSendToPackageDialog((s) => s.seq);
  const taskIds = useSendToPackageDialog((s) => s.taskIds);
  const close = useSendToPackageDialog((s) => s.close);
  const busy = useSendToPackageDialog((s) => s.busy);
  const graphic = useGraphic();
  const authenticated = Boolean(graphic.status?.authenticated);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showClose={!busy}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onPointerDownOutside={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Отправить в пакет графика</DialogTitle>
          <DialogDescription>
            Задачи с бэка станут заданиями пакета Promo Graphic вместе со связями между ними.
          </DialogDescription>
        </DialogHeader>
        {authenticated ? (
          <SendFlow key={seq} taskIds={taskIds} onClose={close} />
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-subhead text-muted-foreground">
            {graphic.status === null
              ? "Проверяю вход в Promo Graphic…"
              : "Войдите в Promo Graphic в окне расширения: иконка на панели браузера → вкладка «Graphic». Диалог продолжит работу сам."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
