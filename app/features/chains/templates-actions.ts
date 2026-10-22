/**
 * Шаблоны канвы — асинхронная часть: сохранение/перезапись в storage, загрузка шаблона на канву
 * (каталог подгружается, если задач шаблона в нём нет), копирование задачи или шаблона
 * на другой проект локальным черновиком. Главный store ведётся через useChainsStore.getState().
 */
import {
  type CanvasTemplate,
  type CanvasViewport,
  getDomainCanvasTemplates,
  upsertDomainCanvasTemplate,
} from "@/lib/storage";
import { fetchTask } from "@/lib/task-api";
import type { TaskLike } from "@/lib/types";

import { EMPTY_GRAPH, stripLocalTaskIds } from "./graph";
import { useLabelsStore } from "./labels-store";
import { useChainsStore } from "./store";
import {
  type FlowViewport,
  type TemplateDraftMatch,
  buildLocalDraftTemplateFromSourceTemplate,
  buildLocalDraftTemplateFromTask,
  buildTemplateDraftMatches,
  buildTemplateSaveToastMessage,
  applyTemplateDraftMatches,
  countTemplateTasks,
  flowViewportFromTemplate,
  planTemplateCanvas,
  restoreGraphFromTemplate,
  serializeCanvasTemplate,
  snapshotTaskBodyForDraft,
  templateCatalogIds,
} from "./templates";

const MAX_CATALOG_PAGES = 40;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type SaveTemplateInput =
  { mode: "new"; name: string } | { mode: "overwrite"; templateId: string };

export interface SaveTemplateResult {
  template: CanvasTemplate;
  isUpdate: boolean;
  message: string;
  /** Есть несохранённые изменения данных задач — в шаблон они не входят. */
  warning: boolean;
}

/** Сохраняет текущую канву как шаблон домена. Ошибки (лимит, пустое имя) — исключением. */
export async function saveCanvasTemplate(
  input: SaveTemplateInput,
  viewport: CanvasViewport,
): Promise<SaveTemplateResult> {
  const store = useChainsStore.getState();
  const domain = store.domain;
  if (!domain) throw new Error("Выберите домен");
  const templates = await getDomainCanvasTemplates(domain);

  let name: string;
  let existing: CanvasTemplate | undefined;
  if (input.mode === "overwrite") {
    existing = templates.find((t) => t.id === input.templateId);
    if (!existing) throw new Error("Шаблон не найден — обновите список");
    name = existing.name;
  } else {
    name = input.name.trim();
    if (!name) throw new Error("Введите название шаблона");
    existing = templates.find((t) => t.name === name);
  }

  const template = serializeCanvasTemplate(
    {
      domain,
      canvas: store.canvas,
      edges: store.edges,
      targetConfigs: store.targetConfigs,
      labels: useLabelsStore.getState().serialize(),
      viewport,
    },
    name,
    { existingId: existing?.id ?? null, createdAt: existing?.createdAt ?? null },
  );
  await upsertDomainCanvasTemplate(domain, template);
  const dirtyCount = store.dirtyTargets.length;
  return {
    template,
    isUpdate: !!existing,
    message: buildTemplateSaveToastMessage(
      name,
      !!existing,
      countTemplateTasks(template),
      dirtyCount,
    ),
    warning: dirtyCount > 0,
  };
}

export interface ApplyTemplateOptions {
  ensureAuthenticated: (domain: string) => Promise<boolean>;
}

export interface ApplyTemplateResult {
  placed: string[];
  missing: string[];
  draftCount: number;
  viewport: FlowViewport | null;
  message: string;
  warning: boolean;
}

/** Догружает каталог страницами, пока не найдутся все `ids` или страницы не кончатся. */
async function ensureCatalogHas(ids: string[]): Promise<void> {
  const store = useChainsStore.getState;
  const missing = () => ids.filter((id) => !store().catalog[id]);
  if (!missing().length) return;
  if (!store().catalogOrder.length) await store().loadCatalog(true);
  for (
    let page = 0;
    page < MAX_CATALOG_PAGES && missing().length && store().catalogHasMore;
    page++
  ) {
    await store().loadCatalog(false);
  }
}

/**
 * Загружает шаблон на канву: канва очищается, задачи ставятся из каталога по id,
 * черновики — из `taskBodies`, затем рёбра, настройки связей, подписи и viewport.
 */
export async function applyCanvasTemplate(
  template: CanvasTemplate,
  { ensureAuthenticated }: ApplyTemplateOptions,
): Promise<ApplyTemplateResult> {
  const store = useChainsStore.getState();
  const domain = store.domain;
  if (!domain) throw new Error("Выберите домен");

  const catalogIds = templateCatalogIds(template);
  if (catalogIds.length) {
    const authed = await ensureAuthenticated(domain);
    const absent = catalogIds.filter((id) => !store.catalog[id]);
    if (absent.length) {
      if (!authed) throw new Error("Вход не выполнен — задачи шаблона не загружены");
      store.setStatus("Загружаю список задач для шаблона…");
      await ensureCatalogHas(absent);
    }
  }

  const plan = planTemplateCanvas(template, useChainsStore.getState().catalog);

  useChainsStore.setState({
    ...EMPTY_GRAPH,
    canvas: plan.placed,
    selectedTaskId: null,
    selectedEdge: null,
  });
  useLabelsStore.getState().clear();

  let done = 0;
  await Promise.all(
    plan.catalogIds.map(async (id) => {
      try {
        await useChainsStore.getState().ensureFull(id);
      } catch {
        useChainsStore.setState((s) => {
          const task = s.canvas[id];
          if (!task || task.conditions != null) return {};
          return { canvas: { ...s.canvas, [id]: { ...task, conditions: [] } } };
        });
      } finally {
        done += 1;
        useChainsStore.getState().setStatus(`Загрузка условий: ${done}/${plan.catalogIds.length}`);
      }
    }),
  );

  useChainsStore.setState((s) => restoreGraphFromTemplate(s, template));
  useLabelsStore.getState().load(template.labels);
  await useChainsStore.getState().persistPositions();

  const placed = Object.keys(useChainsStore.getState().canvas);
  const loadedCount = placed.length;
  useChainsStore.getState().setStatus(`Шаблон «${template.name}»: на канве ${loadedCount} задач`);

  const draftCount = plan.draftIds.length;
  let message: string;
  if (plan.missing.length) {
    message = `Шаблон загружен. ${plan.missing.length} задач не найдено в каталоге и пропущено`;
  } else if (draftCount) {
    message = `Шаблон «${template.name}» загружен (${loadedCount} задач, ${draftCount} только локально). Поправьте данные и сохраните на бэк.`;
  } else {
    message = `Шаблон «${template.name}» загружен (${loadedCount} задач)`;
  }
  return {
    placed,
    missing: plan.missing,
    draftCount,
    viewport: flowViewportFromTemplate(template.viewport),
    message,
    warning: plan.missing.length > 0,
  };
}

export interface MatchTemplateDraftsResult {
  template: CanvasTemplate;
  matched: TemplateDraftMatch[];
  ambiguous: { id: string; name: string }[];
  unmatched: { id: string; name: string }[];
}

/**
 * Находит шаблон домена и сопоставляет его локальные черновики с уже созданными на бэке
 * задачами по имени (с учётом маркера «Season N» — см. findCatalogMatchForDraftName в
 * templates.ts). Требует предварительно загруженный каталог домена.
 */
export async function computeTemplateDraftMatches(
  templateId: string,
): Promise<MatchTemplateDraftsResult> {
  const store = useChainsStore.getState();
  const domain = store.domain;
  const templates = domain ? await getDomainCanvasTemplates(domain) : [];
  const template = templates.find((t) => t.id === templateId);
  if (!template) throw new Error("Шаблон не найден");
  if (!Object.keys(store.catalog).length) {
    throw new Error("Сначала загрузите задачи для домена — кнопка «Загрузить»");
  }
  const { matched, ambiguous, unmatched } = buildTemplateDraftMatches(template, store.catalog);
  return { template, matched, ambiguous, unmatched };
}

/** Применяет найденные совпадения (замена черновиков реальными id) и сохраняет шаблон. */
export async function applyTemplateDraftMatchesAndSave(
  template: CanvasTemplate,
  matched: TemplateDraftMatch[],
): Promise<CanvasTemplate> {
  const domain = useChainsStore.getState().domain;
  const updated = applyTemplateDraftMatches(template, matched);
  await upsertDomainCanvasTemplate(domain, updated);
  return updated;
}

/** Полное тело задачи для копирования: с канвы (у черновика — без локальных id в связях) или с бэка. */
export async function loadFullTaskForCopy(taskId: string): Promise<TaskLike> {
  const state = useChainsStore.getState();
  const id = String(taskId);
  const task = state.canvas[id];
  if (task?.localOnly) {
    if (!task.full) throw new Error("У локального черновика нет данных задачи");
    const conditions = task.conditions ?? (task.full.conditions as TaskLike["conditions"]) ?? [];
    return {
      ...task.full,
      conditions: stripLocalTaskIds(state, Array.isArray(conditions) ? conditions : []),
    };
  }
  if (task?.full) return task.full;
  return fetchTask(state.domain, id);
}

export interface CopyTaskResult {
  template: CanvasTemplate;
  message: string;
}

/** Задача → локальный черновик в шаблонах целевого домена (без создания на бэке). */
export async function copyTaskToProject(
  taskId: string,
  targetDomain: string,
): Promise<CopyTaskResult> {
  const store = useChainsStore.getState();
  store.setStatus(`Готовлю локальный черновик для ${targetDomain}…`);
  try {
    const full = await loadFullTaskForCopy(taskId);
    const fallbackName = store.canvas[taskId]?.name ?? store.catalog[taskId]?.name ?? "";
    const template = buildLocalDraftTemplateFromTask(taskId, full, fallbackName, {
      targetDomain,
      sourceDomain: store.domain,
    });
    await upsertDomainCanvasTemplate(targetDomain, template);
    useChainsStore.getState().setStatus(`Локальный черновик сохранён в шаблонах ${targetDomain}`);
    return {
      template,
      message: `Черновик задачи сохранён на ${targetDomain}. Откройте проект → «Загрузить шаблон», затем поправьте данные перед сохранением на бэк.`,
    };
  } catch (err) {
    useChainsStore.getState().setStatus(`Ошибка копирования черновика: ${errorText(err)}`, true);
    throw new Error(`Не удалось сохранить черновик: ${errorText(err)}`, { cause: err });
  }
}

/** Тела задач шаблона: из taskBodies, с канвы или с бэка текущего домена. */
export async function gatherTaskBodiesForTemplateCopy(
  template: CanvasTemplate,
): Promise<{ bodies: Record<string, TaskLike>; failed: string[] }> {
  const canvas = template.canvas ?? {};
  const existingBodies = template.taskBodies ?? {};
  const ids = Object.keys(canvas);
  const bodies: Record<string, TaskLike> = {};
  const failed: string[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!;
    useChainsStore
      .getState()
      .setStatus(`Собираю данные задач шаблона: ${i + 1}/${ids.length} (#${id})…`);
    const stored = existingBodies[id];
    if (stored) {
      bodies[id] = snapshotTaskBodyForDraft(stored);
      continue;
    }
    const onCanvas = useChainsStore.getState().canvas[id];
    if (onCanvas?.full) {
      bodies[id] = snapshotTaskBodyForDraft(onCanvas.full);
      continue;
    }
    if (canvas[id]?.localOnly === true) {
      failed.push(id);
      continue;
    }
    try {
      bodies[id] = snapshotTaskBodyForDraft(await loadFullTaskForCopy(id));
    } catch {
      failed.push(id);
    }
  }
  return { bodies, failed };
}

export interface CopyTemplateResult {
  template: CanvasTemplate;
  copiedCount: number;
  failed: string[];
  message: string;
  warning: boolean;
}

/** Шаблон текущего домена → шаблон-черновик на целевом домене (все задачи локальные). */
export async function copyTemplateToProject(
  templateId: string,
  targetDomain: string,
): Promise<CopyTemplateResult> {
  const store = useChainsStore.getState();
  const domain = store.domain;
  const templates = domain ? await getDomainCanvasTemplates(domain) : [];
  const source = templates.find((t) => t.id === templateId);
  if (!source) throw new Error("Шаблон не найден на текущем домене");
  if (!countTemplateTasks(source)) throw new Error("В выбранном шаблоне нет задач");

  store.setStatus(`Готовлю черновик шаблона для ${targetDomain}…`);
  try {
    const { bodies, failed } = await gatherTaskBodiesForTemplateCopy(source);
    const copiedCount = Object.keys(bodies).length;
    if (!copiedCount) {
      useChainsStore.getState().setStatus("Копирование шаблона отменено: нет данных задач", true);
      throw new Error("Не удалось загрузить данные ни одной задачи шаблона. Черновик не сохранён.");
    }
    const template = buildLocalDraftTemplateFromSourceTemplate(source, bodies, {
      targetDomain,
      sourceDomain: domain,
    });
    await upsertDomainCanvasTemplate(targetDomain, template);

    let message = `Шаблон «${template.name}» сохранён на ${targetDomain} (${copiedCount} задач`;
    if (template.edges.length) message += `, ${template.edges.length} связей`;
    message += "). Откройте проект → «Загрузить шаблон».";
    if (failed.length) {
      message += ` Не удалось загрузить ${failed.length} задач: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? "…" : ""}.`;
    }
    useChainsStore
      .getState()
      .setStatus(
        failed.length
          ? `Черновик шаблона сохранён на ${targetDomain} (пропущено ${failed.length})`
          : `Черновик шаблона сохранён в шаблонах ${targetDomain}`,
      );
    return { template, copiedCount, failed, message, warning: failed.length > 0 };
  } catch (err) {
    useChainsStore.getState().setStatus(`Ошибка копирования шаблона: ${errorText(err)}`, true);
    throw err;
  }
}
