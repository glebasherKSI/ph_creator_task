/**
 * «Отправить в пакет»: задачи PromoHub (канва / каталог) → задания пакета Promo Graphic.
 * Задача берётся с канвы (если карточка уже загружена и без несохранённых связей) или с бэка,
 * раскладывается mapPhTaskToPlannerImport и уходит пачками в POST /packages/{id}/import —
 * бэк графика сам находит уже отправленные по ph_backend_id и связывает задания по id ПХ.
 * Пачки идут по порядку цепочек, поэтому предшественник уже в графике, когда приходит следующий.
 */
import { graphicApiGet, graphicApiPost } from "@/lib/graphic-api";
import { type PlannerImportItem, mapPhTaskToPlannerImport } from "@/lib/graphic-task-map";
import { setGraphicProjectForDomain } from "@/lib/storage";
import { fetchTask } from "@/lib/task-api";
import type { TaskLike } from "@/lib/types";

import { type GraphicPackage, extractPackages } from "./packages";
import { useChainsStore } from "./store";

const PLANNER = "/api/promohub-planner";

/** Сколько задач грузить из админки одновременно. */
const LOAD_CONCURRENCY = 6;
/** Задач в одном запросе импорта: прогресс виден по ходу, запрос не упирается в таймаут. */
const IMPORT_CHUNK = 20;
const IMPORT_TIMEOUT_MS = 90_000;

export interface GraphicProject {
  id: number;
  code: string;
  display_name: string;
}

export type ImportMode = "update" | "skip";

export interface NewPackageInput {
  name: string;
  kind: "seasonal" | "permanent";
  available_from?: string | null;
  available_till?: string | null;
}

export type PackageTarget = { packageId: number | string } | { create: NewPackageInput };

export interface ImportEntry {
  ph_backend_id: string;
  task_id: number;
  package_id: number;
  /** Задание лежало в другом пакете проекта и перенесено в выбранный. */
  moved_from?: { id: number; name?: string | null };
  /** Пропущенное задание лежит в другом пакете — его название. */
  package_name?: string | null;
}

export interface ImportIssue {
  ph_backend_id: string;
  detail: string;
}

export interface ImportResult {
  created: ImportEntry[];
  updated: ImportEntry[];
  skipped: ImportEntry[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  package: GraphicPackage | null;
}

/** Путь одной задачи: очередь → загрузка → готова → отправка → итог. */
export type TaskSendState =
  | "queued"
  | "loading"
  | "ready"
  | "sending"
  | "created"
  | "updated"
  | "skipped"
  | "error"
  | "draft";

export interface TaskSendRow {
  id: string;
  name: string;
  state: TaskSendState;
  /** Ошибка, предупреждение бэка или откуда взята задача. */
  detail?: string;
  /** Предупреждение (связь не найдена и т.п.) при успешной отправке. */
  warning?: boolean;
  /** Где задание оказалось относительно выбранного пакета: «Перенесено из «…»» / «Лежит в «…»». */
  place?: string;
  /** Перенесено из другого пакета проекта. */
  moved?: boolean;
}

export type SendStage = "load" | "package" | "import";

export interface SendProgress {
  stage: SendStage;
  rows: TaskSendRow[];
}

export interface SendToPackageResult {
  packageName: string;
  package: GraphicPackage | null;
  rows: TaskSendRow[];
}

const FINAL_STATES: ReadonlySet<TaskSendState> = new Set([
  "created",
  "updated",
  "skipped",
  "error",
  "draft",
]);

export function isFinalState(state: TaskSendState): boolean {
  return FINAL_STATES.has(state);
}

export async function loadGraphicProjects(): Promise<GraphicProject[]> {
  const data = await graphicApiGet("/api/projects");
  return Array.isArray(data) ? (data as GraphicProject[]) : [];
}

/** Пакеты проекта без архивных — в них можно отправлять. */
export async function loadProjectPackages(projectCode: string): Promise<GraphicPackage[]> {
  const data = await graphicApiGet(`${PLANNER}/packages`, { project_code: projectCode });
  return extractPackages(data).filter((pkg) => pkg.status !== "archived");
}

function asImportResult(data: unknown): ImportResult {
  const raw = (data && typeof data === "object" ? data : {}) as Partial<ImportResult>;
  return {
    created: raw.created ?? [],
    updated: raw.updated ?? [],
    skipped: raw.skipped ?? [],
    errors: raw.errors ?? [],
    warnings: raw.warnings ?? [],
    package: raw.package ?? null,
  };
}

async function resolvePackage(target: PackageTarget, projectCode: string): Promise<GraphicPackage> {
  if ("packageId" in target) return { id: target.packageId };
  const name = target.create.name.trim();
  if (!name) throw new Error("Введите название пакета");
  const created = (await graphicApiPost(`${PLANNER}/packages`, {
    ...target.create,
    name,
    project_code: projectCode,
    status: "draft",
  })) as GraphicPackage | null;
  if (!created?.id) throw new Error("Promo Graphic не вернул созданный пакет");
  return created;
}

/** Предшественники раньше последователей — тогда связь находится и между пачками. */
function orderByLinks(items: PlannerImportItem[]): PlannerImportItem[] {
  const byId = new Map(items.map((item) => [item.ph_backend_id, item]));
  const done = new Set<string>();
  const out: PlannerImportItem[] = [];
  const visit = (item: PlannerImportItem, path: Set<string>) => {
    if (done.has(item.ph_backend_id) || path.has(item.ph_backend_id)) return;
    path.add(item.ph_backend_id);
    for (const prereq of item.prerequisite_ph_ids) {
      const parent = byId.get(prereq);
      if (parent) visit(parent, path);
    }
    done.add(item.ph_backend_id);
    out.push(item);
  };
  for (const item of items) visit(item, new Set());
  return out;
}

/** Параллельно, но не больше limit запросов к админке разом. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Пачка импорта; при сбое сети или таймауте — ещё одна попытка (импорт идемпотентен). */
async function importChunk(
  packageId: number | string,
  mode: ImportMode,
  tasks: PlannerImportItem[],
): Promise<ImportResult> {
  const send = () =>
    graphicApiPost(`${PLANNER}/packages/${packageId}/import`, { mode, tasks }, IMPORT_TIMEOUT_MS);
  try {
    return asImportResult(await send());
  } catch {
    return asImportResult(await send());
  }
}

export async function sendTasksToPackage(opts: {
  taskIds: string[];
  projectCode: string;
  target: PackageTarget;
  mode: ImportMode;
  onProgress?: (progress: SendProgress) => void;
}): Promise<SendToPackageResult> {
  const { domain, canvas, catalog, dirtyTargets } = useChainsStore.getState();
  if (!domain) throw new Error("Домен не выбран");
  if (!opts.projectCode) throw new Error("Выберите проект в графике");

  const rows: TaskSendRow[] = opts.taskIds.map((id) => {
    const card = canvas[id];
    const name = card?.name || catalog[id]?.name || `#${id}`;
    return card?.localOnly
      ? { id, name, state: "draft", detail: "Черновик — ещё не создан на бэке" }
      : { id, name, state: "queued" };
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  let stage: SendStage = "load";
  const emit = () => opts.onProgress?.({ stage, rows: rows.map((row) => ({ ...row })) });
  const patch = (id: string, next: Partial<TaskSendRow>) => {
    const row = rowById.get(id);
    if (row) Object.assign(row, next);
  };

  // 1. Задачи: с канвы, если карточка уже загружена и связи сохранены; иначе — из админки.
  const dirty = new Set(dirtyTargets);
  const items = new Map<string, PlannerImportItem>();
  const toFetch: TaskSendRow[] = [];
  for (const row of rows) {
    if (row.state !== "queued") continue;
    const card = canvas[row.id];
    if (card?.full && !dirty.has(row.id)) {
      items.set(row.id, mapPhTaskToPlannerImport(card.full, { headerColor: card.headerColor }));
      patch(row.id, { state: "ready", detail: "С канвы" });
    } else {
      toFetch.push(row);
    }
  }
  emit();
  await runPool(toFetch, LOAD_CONCURRENCY, async (row) => {
    patch(row.id, { state: "loading" });
    emit();
    try {
      const task: TaskLike = await fetchTask(domain, row.id);
      items.set(
        row.id,
        mapPhTaskToPlannerImport(task, { headerColor: canvas[row.id]?.headerColor }),
      );
      patch(row.id, { state: "ready", detail: undefined });
    } catch (err) {
      patch(row.id, { state: "error", detail: `Не загрузилась из админки: ${errorText(err)}` });
    }
    emit();
  });
  if (!items.size) {
    throw new Error(
      rows.every((row) => row.state === "draft")
        ? "Выбраны только черновики — сначала создайте их на бэке"
        : "Не удалось загрузить ни одной задачи из админки",
    );
  }

  // 2. Пакет.
  if ("create" in opts.target) {
    stage = "package";
    emit();
  }
  const pkg = await resolvePackage(opts.target, opts.projectCode);
  const packageId = Number(pkg.id);
  let packageInfo: GraphicPackage | null = pkg.name ? pkg : null;

  // 3. Импорт пачками по порядку цепочек.
  stage = "import";
  const ordered = orderByLinks([...items.values()]);
  const idOf = new Map([...items].map(([id, item]) => [item.ph_backend_id, id]));
  for (let start = 0; start < ordered.length; start += IMPORT_CHUNK) {
    const chunk = ordered.slice(start, start + IMPORT_CHUNK);
    for (const item of chunk) patch(idOf.get(item.ph_backend_id)!, { state: "sending" });
    emit();
    try {
      const result = await importChunk(packageId, opts.mode, chunk);
      packageInfo = result.package ?? packageInfo;
      const mark = (entries: ImportEntry[], state: TaskSendState) => {
        for (const entry of entries) {
          const id = idOf.get(String(entry.ph_backend_id));
          if (!id) continue;
          const from = entry.moved_from;
          const place = from
            ? `Перенесено из пакета «${from.name ?? `#${from.id}`}»`
            : entry.package_name
              ? `Лежит в пакете «${entry.package_name}»`
              : undefined;
          patch(id, { state, detail: undefined, place, moved: Boolean(from) });
        }
      };
      mark(result.created, "created");
      mark(result.updated, "updated");
      mark(result.skipped, "skipped");
      for (const issue of result.errors) {
        const id = idOf.get(String(issue.ph_backend_id));
        if (id) patch(id, { state: "error", detail: issue.detail });
      }
      for (const issue of result.warnings) {
        const id = idOf.get(String(issue.ph_backend_id));
        if (id) patch(id, { warning: true, detail: issue.detail });
      }
      // Бэк промолчал о задаче — не оставляем её «в отправке».
      for (const item of chunk) {
        const id = idOf.get(item.ph_backend_id)!;
        if (rowById.get(id)?.state === "sending") {
          patch(id, { state: "error", detail: "Бэк графика не вернул результат" });
        }
      }
    } catch (err) {
      for (const item of chunk) {
        patch(idOf.get(item.ph_backend_id)!, {
          state: "error",
          detail: `Не отправлено: ${errorText(err)}`,
        });
      }
    }
    emit();
  }

  await setGraphicProjectForDomain(domain, opts.projectCode);
  return {
    packageName: packageInfo?.name ?? `#${packageId}`,
    package: packageInfo,
    rows: rows.map((row) => ({ ...row })),
  };
}

export interface SendCounts {
  total: number;
  /** Загружены (или упали при загрузке) — для первой половины прогресса. */
  loaded: number;
  /** Дошли до итога. */
  finished: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: number;
  drafts: number;
  moved: number;
}

export function countRows(rows: TaskSendRow[]): SendCounts {
  const counts: SendCounts = {
    total: rows.length,
    loaded: 0,
    finished: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    warnings: 0,
    drafts: 0,
    moved: 0,
  };
  for (const row of rows) {
    if (row.state !== "queued" && row.state !== "loading") counts.loaded += 1;
    if (isFinalState(row.state)) counts.finished += 1;
    if (row.state === "created") counts.created += 1;
    if (row.state === "updated") counts.updated += 1;
    if (row.state === "skipped") counts.skipped += 1;
    if (row.state === "error") counts.errors += 1;
    if (row.state === "draft") counts.drafts += 1;
    if (row.warning) counts.warnings += 1;
    if (row.moved) counts.moved += 1;
  }
  return counts;
}

/** Общий процент: загрузка — первая треть, отправка — остальное. */
export function sendPercent(rows: TaskSendRow[]): number {
  const c = countRows(rows);
  if (!c.total) return 0;
  return Math.round((c.loaded / c.total) * 35 + (c.finished / c.total) * 65);
}
