import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { type CanvasTask, type GraphState, EMPTY_GRAPH, addEdge } from "@/features/chains/graph";
import { useLabelsStore, parseCanvasLabels } from "@/features/chains/labels-store";
import { GRID_START_X, GRID_START_Y } from "@/features/chains/layout";
import { type CatalogTask, useChainsStore } from "@/features/chains/store";
import {
  buildLoadTemplateConfirmMessage,
  buildLocalDraftTemplateFromSourceTemplate,
  buildLocalDraftTemplateFromTask,
  buildTemplateSaveToastMessage,
  countTemplateLocalDrafts,
  flowViewportFromTemplate,
  planTemplateCanvas,
  restoreGraphFromTemplate,
  serializeCanvasTemplate,
  snapshotTaskBodyForDraft,
  templateCatalogIds,
  templateMetaLine,
} from "@/features/chains/templates";
import { applyCanvasTemplate, saveCanvasTemplate } from "@/features/chains/templates-actions";
import { MAX_CANVAS_TEMPLATES_PER_DOMAIN } from "@/lib/constants";
import { type CanvasTemplate, getDomainCanvasTemplates } from "@/lib/storage";
import type { GamificationTask } from "@/lib/types";

// Бэк в тестах: задача #id с одной связью «#1 → #2» в conditions, страница каталога из 1..3.
vi.mock("@/lib/task-api", () => ({
  fetchTask: vi.fn(async (_domain: string, id: string | number) => ({
    id: Number(id),
    name: `Backend ${id}`,
    frontend_identifier: `fe_${id}`,
    state: "active",
    type: "interactive",
    conditions:
      String(id) === "2" ? [{ gamification_tasks: { list: ["1"], type: "enabled" } }] : [],
  })),
  fetchTasksPage: vi.fn(async () => ({
    tasks: [1, 2, 3].map((id) => ({
      id,
      name: `Backend ${id}`,
      frontend_identifier: `fe_${id}`,
      state: "active",
      type: "interactive",
    })) as GamificationTask[],
    hidden: 0,
    rawCount: 3,
    hasMore: false,
  })),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

const DOMAIN = "admin.example.test";

function catalogEntry(id: string): CatalogTask {
  return {
    id,
    name: `Task ${id}`,
    frontend_identifier: `fe_${id}`,
    state: "active",
    type: "interactive",
    available_from: null,
    available_till: null,
    main_bonus_group_id: null,
  };
}

function backendTask(id: string, extra: Partial<CanvasTask> = {}): CanvasTask {
  return {
    id,
    name: `Task ${id}`,
    frontend_identifier: `fe_${id}`,
    conditions: [],
    full: { id: Number(id), name: `Task ${id}` },
    x: 100,
    y: 200,
    ...extra,
  };
}

function draftTask(id: string, extra: Partial<CanvasTask> = {}): CanvasTask {
  return {
    id,
    name: "Draft",
    frontend_identifier: "fe_draft",
    conditions: [],
    full: { name: "Draft", frontend_identifier: "fe_draft", x: 1, y: 2, localOnly: true },
    x: 500,
    y: 40,
    localOnly: true,
    ...extra,
  };
}

/** Граф: 1 → 2, 2 → local_a (черновик). */
function sampleGraph(): GraphState {
  let state: GraphState = {
    ...EMPTY_GRAPH,
    canvas: {
      "1": backendTask("1", { headerColor: "green", configuredOnBackend: true }),
      "2": backendTask("2", { x: 400 }),
      local_a: draftTask("local_a", { headerColor: "nope" }),
    },
  };
  state = addEdge(state, "1", "2");
  state = addEdge(state, "2", "local_a");
  state = {
    ...state,
    targetConfigs: {
      ...state.targetConfigs,
      "2": { type: "disabled", extra_type: "and", only_completed: false },
    },
  };
  return state;
}

function serializeSample(name = "Сезон 3"): CanvasTemplate {
  const g = sampleGraph();
  return serializeCanvasTemplate(
    {
      domain: DOMAIN,
      canvas: g.canvas,
      edges: g.edges,
      targetConfigs: g.targetConfigs,
      labels: [{ id: "lbl_1", text: "Старт", x: 10, y: 20 }],
      viewport: { x: -50, y: 30, scale: 0.75 },
    },
    name,
    { now: "2026-05-01T10:00:00.000Z" },
  );
}

beforeEach(() => {
  fakeBrowser.reset();
  useChainsStore.setState({ ...EMPTY_GRAPH, domain: "", catalog: {}, catalogOrder: [] });
  useLabelsStore.getState().clear();
});

describe("templates — сериализация", () => {
  it("serializeCanvasTemplate: раскладка, тела черновиков, рёбра, настройки, подписи, viewport", () => {
    const tpl = serializeSample();
    expect(tpl.id).toBeTruthy();
    expect(tpl).toMatchObject({
      name: "Сезон 3",
      domain: DOMAIN,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:00:00.000Z",
      labels: [{ id: "lbl_1", text: "Старт", x: 10, y: 20 }],
      viewport: { x: -50, y: 30, scale: 0.75 },
    });
    expect(tpl.canvas).toEqual({
      "1": { x: 100, y: 200, headerColor: "green", configuredOnBackend: true },
      "2": { x: 400, y: 200 },
      local_a: { x: 500, y: 40, localOnly: true, configuredOnBackend: false },
    });
    expect(tpl.edges).toEqual([
      { from: "1", to: "2" },
      { from: "2", to: "local_a" },
    ]);
    expect(tpl.targetConfigs).toEqual({
      "2": { type: "disabled", extra_type: "and", only_completed: false },
      local_a: { type: "enabled", extra_type: "or", only_completed: true },
    });
    // Тело черновика — без служебных полей канвы.
    expect(tpl.taskBodies).toEqual({ local_a: { name: "Draft", frontend_identifier: "fe_draft" } });
    expect(countTemplateLocalDrafts(tpl)).toBe(1);
    expect(templateCatalogIds(tpl)).toEqual(["1", "2"]);
    expect(templateMetaLine(tpl)).toMatch(/^3 задач · 2 связей · 1 черновик\. · /);
  });

  it("существующий шаблон: сохраняется id и createdAt, обновляется updatedAt", () => {
    const g = sampleGraph();
    const tpl = serializeCanvasTemplate(
      {
        domain: DOMAIN,
        canvas: g.canvas,
        edges: [],
        targetConfigs: {},
        labels: [],
        viewport: { x: 0, y: 0, scale: 1 },
      },
      "  X  ",
      {
        existingId: "tpl-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        now: "2026-02-02T00:00:00.000Z",
      },
    );
    expect(tpl).toMatchObject({
      id: "tpl-1",
      name: "X",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
  });

  it("snapshotTaskBodyForDraft не мутирует исходник и чистит служебные поля", () => {
    const body = {
      name: "A",
      x: 1,
      y: 2,
      headerColor: "red",
      localOnly: true,
      _full: {},
      nested: { a: 1 },
    };
    const snap = snapshotTaskBodyForDraft(body);
    expect(snap).toEqual({ name: "A", nested: { a: 1 } });
    expect(body.nested).not.toBe(snap.nested);
  });

  it("тексты подтверждения и тоста", () => {
    const tpl = serializeSample();
    expect(buildLoadTemplateConfirmMessage(tpl, { dirtyCount: 0, canvasCount: 0 })).toBe(
      "Загрузить шаблон «Сезон 3» (3 задач)?\nТекущая канва будет заменена.",
    );
    expect(buildLoadTemplateConfirmMessage(tpl, { dirtyCount: 2, canvasCount: 5 })).toContain(
      "Внимание: у 2 задач есть несохранённые изменения — они будут потеряны.",
    );
    expect(buildLoadTemplateConfirmMessage(tpl, { dirtyCount: 0, canvasCount: 5 })).toContain(
      "С канвы будет снято 5 задач.",
    );
    expect(buildTemplateSaveToastMessage("N", false, 3, 0)).toBe("Шаблон «N» сохранён (3 задач)");
    expect(buildTemplateSaveToastMessage("N", true, 0, 1)).toBe(
      "Шаблон «N» обновлён. Несохранённые изменения данных задач в шаблон не входят",
    );
  });

  it("viewport шаблона → React Flow с ограничением зума", () => {
    expect(flowViewportFromTemplate({ x: 1, y: 2, scale: 0.05 })).toEqual({
      x: 1,
      y: 2,
      zoom: 0.2,
    });
    expect(flowViewportFromTemplate({ x: "3", y: null, scale: 9 })).toEqual({
      x: 3,
      y: 0,
      zoom: 2,
    });
    expect(flowViewportFromTemplate(null)).toBeNull();
  });

  it("parseCanvasLabels: пропускает записи без координат, подставляет id и текст", () => {
    const labels = parseCanvasLabels([
      { id: "a", text: "  Hi ", x: 1, y: 2 },
      { text: "", x: "3", y: 4 },
      { id: "bad", text: "no coords" },
      null,
    ]);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({ id: "a", text: "Hi", x: 1, y: 2 });
    expect(labels[1]).toMatchObject({ text: "Подпись", x: 3, y: 4 });
    expect(labels[1]!.id).toMatch(/^lbl_/);
  });
});

describe("templates — план и восстановление графа", () => {
  it("planTemplateCanvas: каталожные задачи, черновики из taskBodies, пропуски", () => {
    const tpl = serializeSample();
    tpl.canvas["77"] = { x: 1, y: 1 };
    tpl.canvas.local_lost = { x: 1, y: 1, localOnly: true };
    const plan = planTemplateCanvas(tpl, { "1": catalogEntry("1"), "2": catalogEntry("2") });
    expect(plan.catalogIds).toEqual(["1", "2"]);
    expect(plan.draftIds).toEqual(["local_a"]);
    expect(plan.missing).toEqual(["77", "local_lost"]);
    expect(plan.placed["1"]).toMatchObject({
      id: "1",
      name: "Task 1",
      conditions: null,
      full: null,
      x: 100,
      y: 200,
      headerColor: "green",
      configuredOnBackend: true,
    });
    expect(plan.placed["2"]!.headerColor).toBeUndefined();
    expect(plan.placed.local_a).toMatchObject({
      localOnly: true,
      name: "Draft",
      frontend_identifier: "fe_draft",
      full: { name: "Draft", frontend_identifier: "fe_draft" },
      x: 500,
      y: 40,
    });
    expect(plan.placed.local_a!.headerColor).toBeUndefined();
  });

  it("restoreGraphFromTemplate: рёбра между карточками, настройки, conditions из рёбер, без dirty", () => {
    const tpl = serializeSample();
    tpl.edges.push({ from: "1", to: "999" }, { from: "2", to: "2" }, { from: "1", to: "2" });
    const plan = planTemplateCanvas(tpl, { "1": catalogEntry("1"), "2": catalogEntry("2") });
    const state = restoreGraphFromTemplate({ ...EMPTY_GRAPH, canvas: plan.placed }, tpl);
    expect(state.edges).toEqual([
      { from: "1", to: "2" },
      { from: "2", to: "local_a" },
    ]);
    expect(state.targetConfigs).toEqual({
      "2": { type: "disabled", extra_type: "and", only_completed: false },
      local_a: { type: "enabled", extra_type: "or", only_completed: true },
    });
    expect(state.dirtyTargets).toEqual([]);
    expect(state.canvas["2"]!.conditions).toEqual([
      {
        gamification_tasks: {
          list: ["1"],
          type: "disabled",
          extra_type: "and",
          only_completed: false,
        },
      },
    ]);
    expect(state.canvas.local_a!.conditions).toEqual([
      {
        gamification_tasks: {
          list: ["2"],
          type: "enabled",
          extra_type: "or",
          only_completed: true,
        },
      },
    ]);
  });
});

describe("templates — черновики для другого проекта", () => {
  it("buildLocalDraftTemplateFromSourceTemplate: переназначение id в canvas/edges/configs", () => {
    const src = serializeSample("Исходный");
    src.targetConfigs["2"] = { list: ["1", "404"], type: "enabled", extra_type: "and" };
    const bodies = { "1": { name: "One" }, "2": { name: "Two" }, local_a: { name: "Draft" } };
    let seq = 0;
    const draft = buildLocalDraftTemplateFromSourceTemplate(src, bodies, {
      targetDomain: "target.test",
      sourceDomain: DOMAIN,
      now: "2026-06-01T00:00:00.000Z",
      newTemplateId: () => "new-tpl",
      newDraftId: () => `local_n${++seq}`,
    });
    expect(draft).toMatchObject({
      id: "new-tpl",
      name: "Черновик: Исходный",
      domain: "target.test",
      sourceDomain: DOMAIN,
      sourceTemplateId: src.id,
      isLocalDraftTemplate: true,
      createdAt: "2026-06-01T00:00:00.000Z",
      labels: [{ id: "lbl_1", text: "Старт", x: 10, y: 20 }],
      viewport: { x: -50, y: 30, scale: 0.75 },
    });
    expect(draft.canvas).toEqual({
      local_n1: {
        x: 100,
        y: 200,
        localOnly: true,
        configuredOnBackend: false,
        headerColor: "green",
      },
      local_n2: { x: 400, y: 200, localOnly: true, configuredOnBackend: false },
      local_n3: { x: 500, y: 40, localOnly: true, configuredOnBackend: false },
    });
    expect(draft.taskBodies).toEqual({
      local_n1: { name: "One" },
      local_n2: { name: "Two" },
      local_n3: { name: "Draft" },
    });
    expect(draft.edges).toEqual([
      { from: "local_n1", to: "local_n2" },
      { from: "local_n2", to: "local_n3" },
    ]);
    // list переназначается, неизвестные id выпадают; дефолты дописываются.
    expect(draft.targetConfigs.local_n2).toEqual({
      list: ["local_n1"],
      type: "enabled",
      extra_type: "and",
      only_completed: true,
    });
    expect(draft.labels![0]).not.toBe(src.labels[0]);
    expect(countTemplateLocalDrafts(draft)).toBe(3);
  });

  it("buildLocalDraftTemplateFromTask: один черновик в стартовой позиции", () => {
    const tpl = buildLocalDraftTemplateFromTask("42", { id: 42, name: "Answer", x: 9 }, "", {
      targetDomain: "target.test",
      sourceDomain: DOMAIN,
      now: "2026-06-01T00:00:00.000Z",
      newTemplateId: () => "t",
      newDraftId: () => "local_d",
    });
    expect(tpl).toMatchObject({
      id: "t",
      name: "Черновик: Answer",
      domain: "target.test",
      sourceTaskId: "42",
      isLocalDraftTemplate: true,
      canvas: {
        local_d: { x: GRID_START_X, y: GRID_START_Y, localOnly: true, configuredOnBackend: false },
      },
      taskBodies: { local_d: { id: 42, name: "Answer" } },
      edges: [],
      labels: [],
    });
    const unnamed = buildLocalDraftTemplateFromTask("7", {}, "", {
      targetDomain: "t",
      sourceDomain: DOMAIN,
    });
    expect(unnamed.name).toBe(`Черновик с ${DOMAIN} (#7)`);
  });
});

describe("templates — сохранение и загрузка через store", () => {
  it("roundtrip: сохранить канву с черновиком и подписью, загрузить обратно", async () => {
    const g = sampleGraph();
    useChainsStore.setState({
      ...g,
      dirtyTargets: [],
      domain: DOMAIN,
      catalog: { "1": catalogEntry("1"), "2": catalogEntry("2") },
      catalogOrder: ["1", "2"],
    });
    useLabelsStore.getState().load([{ id: "lbl_1", text: "Старт", x: 10, y: 20 }]);

    const saved = await saveCanvasTemplate(
      { mode: "new", name: "Сезон 3" },
      { x: -50, y: 30, scale: 0.75 },
    );
    expect(saved.isUpdate).toBe(false);
    expect(saved.message).toBe("Шаблон «Сезон 3» сохранён (3 задач)");
    const stored = await getDomainCanvasTemplates(DOMAIN);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.labels).toEqual([{ id: "lbl_1", text: "Старт", x: 10, y: 20 }]);
    expect(Object.keys(stored[0]!.taskBodies ?? {})).toEqual(["local_a"]);

    // Перезапись по id: тот же шаблон, createdAt сохраняется.
    const again = await saveCanvasTemplate(
      { mode: "overwrite", templateId: stored[0]!.id },
      { x: 0, y: 0, scale: 1 },
    );
    expect(again.isUpdate).toBe(true);
    expect(again.template.createdAt).toBe(stored[0]!.createdAt);
    expect(await getDomainCanvasTemplates(DOMAIN)).toHaveLength(1);

    // Пустая канва и другие подписи → загрузка шаблона всё восстанавливает.
    useChainsStore.setState({ ...EMPTY_GRAPH, selectedTaskId: "1" });
    useLabelsStore.getState().load([{ id: "lbl_old", text: "Старое", x: 0, y: 0 }]);
    const result = await applyCanvasTemplate(stored[0]!, { ensureAuthenticated: async () => true });

    const state = useChainsStore.getState();
    expect(result.placed.sort()).toEqual(["1", "2", "local_a"]);
    expect(result.missing).toEqual([]);
    expect(result.draftCount).toBe(1);
    expect(result.viewport).toEqual({ x: -50, y: 30, zoom: 0.75 });
    expect(result.message).toContain("1 только локально");
    expect(state.selectedTaskId).toBeNull();
    expect(state.canvas["1"]).toMatchObject({
      x: 100,
      y: 200,
      headerColor: "green",
      configuredOnBackend: true,
      name: "Backend 1",
    });
    expect(state.canvas["1"]!.full).toMatchObject({ id: 1 });
    expect(state.canvas.local_a).toMatchObject({ localOnly: true, name: "Draft", x: 500, y: 40 });
    expect(state.edges).toEqual([
      { from: "1", to: "2" },
      { from: "2", to: "local_a" },
    ]);
    expect(state.targetConfigs["2"]).toEqual({
      type: "disabled",
      extra_type: "and",
      only_completed: false,
    });
    expect(state.dirtyTargets).toEqual([]);
    expect(useLabelsStore.getState().labels).toEqual([
      { id: "lbl_1", text: "Старт", x: 10, y: 20 },
    ]);
    expect(state.status.text).toBe("Шаблон «Сезон 3»: на канве 3 задач");
    // Позиции ушли в storage раскладки.
    const layout = await fakeBrowser.storage.local.get(`ph_chains_layout_${DOMAIN}`);
    expect(layout[`ph_chains_layout_${DOMAIN}`]).toMatchObject({
      positions: { "1": { x: 100, y: 200 }, local_a: { localOnly: true } },
    });
  });

  it("каталог догружается, если задач шаблона в нём нет; лишние пропускаются", async () => {
    useChainsStore.setState({ domain: DOMAIN, catalog: {}, catalogOrder: [] });
    const tpl = serializeSample();
    tpl.canvas["77"] = { x: 0, y: 0 };
    const ensureAuthenticated = vi.fn(async () => true);
    const result = await applyCanvasTemplate(tpl, { ensureAuthenticated });
    expect(ensureAuthenticated).toHaveBeenCalledWith(DOMAIN);
    expect(Object.keys(useChainsStore.getState().catalog).sort()).toEqual(["1", "2", "3"]);
    expect(result.placed.sort()).toEqual(["1", "2", "local_a"]);
    expect(result.missing).toEqual(["77"]);
    expect(result.warning).toBe(true);
    expect(result.message).toBe("Шаблон загружен. 1 задач не найдено в каталоге и пропущено");
  });

  it("без входа каталог не грузится — ошибка; без домена — ошибка", async () => {
    useChainsStore.setState({ domain: DOMAIN, catalog: {}, catalogOrder: [] });
    await expect(
      applyCanvasTemplate(serializeSample(), { ensureAuthenticated: async () => false }),
    ).rejects.toThrow("Вход не выполнен");
    useChainsStore.setState({ domain: "" });
    await expect(
      saveCanvasTemplate({ mode: "new", name: "x" }, { x: 0, y: 0, scale: 1 }),
    ).rejects.toThrow("Выберите домен");
  });

  it("лимит шаблонов на домен приходит ошибкой из storage", async () => {
    useChainsStore.setState({ ...sampleGraph(), domain: DOMAIN });
    for (let i = 0; i < MAX_CANVAS_TEMPLATES_PER_DOMAIN; i += 1) {
      await saveCanvasTemplate({ mode: "new", name: `T${i}` }, { x: 0, y: 0, scale: 1 });
    }
    await expect(
      saveCanvasTemplate({ mode: "new", name: "Over" }, { x: 0, y: 0, scale: 1 }),
    ).rejects.toThrow(`Достигнут лимит: ${MAX_CANVAS_TEMPLATES_PER_DOMAIN} шаблонов на домен`);
    // Перезапись одноимённого — не новый шаблон, лимит не мешает.
    const ok = await saveCanvasTemplate({ mode: "new", name: "T0" }, { x: 0, y: 0, scale: 1 });
    expect(ok.isUpdate).toBe(true);
    expect(await getDomainCanvasTemplates(DOMAIN)).toHaveLength(MAX_CANVAS_TEMPLATES_PER_DOMAIN);
  });
});
