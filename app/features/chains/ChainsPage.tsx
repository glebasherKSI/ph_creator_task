/** Страница «Конструктор связей»: домен → каталог → канва React Flow → панель связи и форма задачи. */
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import {
  BookmarkPlus,
  Columns3,
  Download,
  FolderOpen,
  Loader2,
  Maximize2,
  MoreHorizontal,
  RefreshCw,
  Save,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { exportBackup, importBackup } from "@/components/backup-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { useAuth } from "@/features/auth/AuthModal";
import { useDomainList } from "./useDomainList";
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
import { type CatalogProgress, type SaveLogEntry, useChainsStore } from "./store";
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

function catalogLoadingLabel(progress: CatalogProgress | null): string {
  if (!progress) return "Загрузить задачи";
  if (progress.phase === "auth") return "Проверяю вход…";
  if (progress.total)
    return `Загружаю ${Math.min(progress.scanned, progress.total)} / ${progress.total}`;
  return progress.scanned ? `Загружаю… ${progress.scanned}` : "Загружаю…";
}

/** Группа инструментов: подпись слева и кнопки в общей подложке. */
function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-caption text-muted-foreground uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-0.5 rounded-md bg-surface-2/50 p-0.5">{children}</div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-left text-subhead hover:bg-surface-2"
    >
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </button>
  );
}

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
  const catalogProgress = useChainsStore((s) => s.catalogProgress);
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
    // Индикатор сразу: проверка входа может перезагрузить вкладку админки и занять секунды.
    const store = useChainsStore.getState();
    store.setCatalogAuthPhase(true);
    setStatus(`Проверяю вход в ${domain}…`);
    let ok = false;
    try {
      ok = await auth.ensureAuthenticated(domain, {
        message: `Для загрузки задач нужен вход в ${domain}`,
      });
    } finally {
      if (!ok) store.setCatalogAuthPhase(false);
    }
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
      <header className="flex flex-col rounded-lg bg-surface">
        {/* Уровень 1: раздел и источник данных */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
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
          <div className="ml-auto flex items-center gap-2">
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
            <Button
              variant="secondary"
              size="sm"
              disabled={!domain || catalogLoading}
              onClick={() => void loadTasks(true)}
              title="Загрузить список задач домена (с входом в админку при необходимости)"
            >
              {catalogLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {catalogLoadingLabel(catalogProgress)}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Ещё" title="Ещё">
                  <MoreHorizontal />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60">
                <MenuItem icon={Download} onClick={() => void exportBackup()}>
                  Экспорт данных
                </MenuItem>
                <MenuItem icon={Upload} onClick={() => void importBackup()}>
                  Импорт данных
                </MenuItem>
                <p className="px-2 pt-1 pb-1.5 text-caption text-muted-foreground">
                  Домены, сессии, шаблоны и раскладки в JSON
                </p>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Уровень 2: инструменты канвы */}
        {view === "canvas" ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2 [&>[role=group]+[role=group]]:border-l [&>[role=group]+[role=group]]:border-border [&>[role=group]+[role=group]]:pl-4">
            <ToolGroup label="Вид">
              <Button
                variant="ghost"
                size="sm"
                disabled={!canvasSize}
                onClick={() => fit()}
                title="Показать все карточки"
              >
                <Maximize2 /> Вписать
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canvasSize}
                onClick={align}
                title="Разложить карточки по колонкам цепочек"
              >
                <Columns3 /> Выровнять
              </Button>
            </ToolGroup>
            <ToolGroup label="Добавить">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addLabel()}
                title="Добавить подпись в центр канвы"
              >
                <Tag /> Подпись
              </Button>
            </ToolGroup>
            <ToolGroup label="Шаблон">
              <Button
                variant="ghost"
                size="sm"
                disabled={!canvasSize}
                title="Сохранить раскладку канвы как шаблон"
                onClick={() => useSaveTemplateDialog.getState().show()}
              >
                <BookmarkPlus /> Сохранить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!domain}
                title="Загрузить сохранённый шаблон канвы"
                onClick={() => useLoadTemplateDialog.getState().show()}
              >
                <FolderOpen /> Загрузить
              </Button>
            </ToolGroup>
            <ToolGroup label="Выделение">
              <SelectionToolbar />
            </ToolGroup>

            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <SwitchField
                  label="Проверить блоки"
                  checked={checkBlocks}
                  onCheckedChange={setCheckBlocks}
                  title="Подсветить параллельные задачи с кнопкой «Согласие игрока» и одинаковым целевым действием"
                />
                {checkBlocks ? (
                  <Badge
                    variant={blockConflicts.length ? "destructive" : "muted"}
                    title={
                      blockConflicts.length
                        ? blockConflicts.map((c) => c.tooltip).join("\n")
                        : "Число групп с блокирующим конфликтом на канве"
                    }
                  >
                    {formatConflictsCounter(blockConflicts.length)}
                  </Badge>
                ) : null}
              </div>
              <div className="h-6 w-px bg-border" aria-hidden="true" />
              <Button
                variant="primary"
                size="sm"
                disabled={!dirtyCount || saving}
                onClick={() => void save()}
                title={
                  dirtyCount ? "Сохранить изменённые связи на бэк" : "Нет несохранённых изменений"
                }
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Сохранить{dirtyCount ? ` (${dirtyCount})` : ""}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Статус и счётчики */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-caption">
          <p
            role="status"
            className={cn(
              "min-w-0 flex-1 truncate",
              status.error ? "text-destructive" : "text-muted-foreground",
            )}
            title={status.text}
          >
            {status.text}
          </p>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {catalogSize} в каталоге · {canvasSize} на канве
            {dirtyCount ? <span className="text-primary"> · {dirtyCount} не сохранено</span> : null}
          </span>
        </div>
      </header>

      {/* Канва всегда смонтирована: переключение вкладок не теряет viewport и выделение. */}
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3",
          view !== "canvas" && "hidden",
          selectedEdge ? "grid-cols-[22rem_minmax(0,1fr)_auto]" : "grid-cols-[22rem_minmax(0,1fr)]",
        )}
      >
        <CatalogSidebar
          onAdd={addToCanvas}
          onFocusNode={focusNode}
          hasMore={catalogHasMore}
          loadingMore={catalogLoading}
          onLoadMore={() => void loadTasks(false)}
        />
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
