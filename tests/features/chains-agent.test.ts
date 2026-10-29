import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { AgentMessage, AgentStepReply } from "@/features/chains/agent-api";
import type { TaskLike } from "@/lib/types";

const createTask = vi.fn();
vi.mock("@/lib/task-api", () => ({
  fetchTasksPage: vi.fn(),
  fetchTask: vi.fn(),
  updateTask: vi.fn(),
  createTask: (...args: unknown[]) => createTask(...args),
}));
const logTaskEvent = vi.fn();
vi.mock("@/lib/task-events", () => ({
  logTaskEvent: (...args: unknown[]) => logTaskEvent(...args),
}));
const agentStep = vi.fn();
const finishAgentRun = vi.fn();
vi.mock("@/features/chains/agent-api", () => ({
  agentStep: (...args: unknown[]) => agentStep(...args),
  finishAgentRun: (...args: unknown[]) => finishAgentRun(...args),
}));
const notifyGraphicBackendCreated = vi.fn();
vi.mock("@/features/chains/packages-actions", () => ({
  notifyGraphicBackendCreated: (...args: unknown[]) => notifyGraphicBackendCreated(...args),
  openPackageOnCanvas: vi.fn(),
}));
const META = {
  events: ["login"],
  filters: [],
  tags: [{ id: 5, name: "Хэллоуин" }],
  bonuses: [
    { id: "1:GAMIFICATION BONUS POINTS 10", title: "10 pts" },
    { id: "2:GAMIFICATION BONUS POINTS 50", title: "50 pts" },
  ],
  notification_events: [],
  dsl_tags: [],
  categories: ["basic"],
  types: ["interactive"],
  priorities: [0, 1, 2, 3, 4],
};
vi.mock("@/lib/meta", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta")>()),
  loadTaskMeta: async () => META,
}));
vi.mock("@/lib/conditions-schema", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/conditions-schema")>()),
  loadConditionsSchema: async () => {
    throw new Error("нет сети");
  },
}));
vi.mock("@/features/task-form/country-selector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/task-form/country-selector")>()),
  loadCountriesData: async () => {
    throw new Error("нет сети");
  },
}));

const { useChainsStore } = await import("@/features/chains/store");
const { buildDraftPayload } = await import("@/features/chains/draft-pipeline");
const { applyDraftPatch, draftWarnings, fieldsForAgent, briefForAgent, runAgentTool, AGENT_TOOLS } =
  await import("@/features/chains/agent-tools");
const { parseToolArgs, runAgent, toolOutcome, toolResultText, useAgentPanel } =
  await import("@/features/chains/agent-run");

function draftBody(extra: TaskLike = {}): TaskLike {
  return {
    name: "Депозит",
    frontend_identifier: "deposit_20",
    type: "interactive",
    hidden: false,
    state: "draft",
    locales: { ru: "Сделай депозит" },
    events: ["login"],
    available_from: "2026-11-01T00:00:00Z",
    available_till: "2026-11-30T00:00:00Z",
    serialized_main_actions: [{ action: "deposit", requirements: {}, conditions: {} }],
    serialized_secondary_actions: [],
    conditions: [],
    main_bonus_group_id: null,
    secondary_bonus_group_id: null,
    _plannerTaskId: 77,
    _plannerRewardPoints: 50,
    _plannerTag: "Хэллоуин",
    _plannerNote: "Награда 50 pts, депозит от 20 €",
    ...extra,
  };
}

function card(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `T${id}`,
    frontend_identifier: `t${id}`,
    conditions: [],
    full: null,
    x: 0,
    y: 0,
    ...extra,
  };
}

const GT = {
  gamification_tasks: { list: ["10"], type: "enabled", extra_type: "or", only_completed: true },
};

function ctx(scope: string[] | null = null) {
  return {
    runId: "run-1",
    domain: "admin.example.com",
    refs: { meta: META, conditionsSchema: null, countries: null },
    scope: scope ? new Set(scope) : null,
    ensureAuthenticated: async () => true,
    onCreated: vi.fn(),
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  for (const fn of [
    createTask,
    logTaskEvent,
    agentStep,
    finishAgentRun,
    notifyGraphicBackendCreated,
  ]) {
    fn.mockReset();
  }
  useChainsStore.setState({ domain: "" });
  await useChainsStore.getState().setDomain("admin.example.com");
  useChainsStore.setState({
    canvas: {
      "10": card("10"),
      local_a: card("local_a", { name: "Депозит", localOnly: true, full: draftBody() }),
      local_b: card("local_b", {
        name: "Ставка",
        localOnly: true,
        full: draftBody({ name: "Ставка", frontend_identifier: "bet", _plannerTaskId: 78 }),
      }),
    },
    edges: [{ from: "local_a", to: "local_b" }],
    dirtyTargets: [],
    selectedIds: [],
  });
  useAgentPanel.setState({ entries: [], created: [], running: false, stopRequested: false });
});

describe("buildDraftPayload", () => {
  it("как форма: бонус по наградe и тег из брифа, статус draft, без ошибок схемы", () => {
    const built = buildDraftPayload(useChainsStore.getState(), "local_a", { meta: META })!;
    expect(built.errors).toEqual([]);
    expect(built.payload.gamification_task).toMatchObject({
      state: "draft",
      main_bonus_group_id: "2:GAMIFICATION BONUS POINTS 50",
      tag_id: 5,
    });
  });

  it("не черновик — null; без имени — ошибка сборки payload", () => {
    const state = useChainsStore.getState();
    expect(buildDraftPayload(state, "10", { meta: META })).toBeNull();
    useChainsStore.setState({
      canvas: {
        ...state.canvas,
        local_a: card("local_a", { localOnly: true, full: draftBody({ name: "" }) }),
      },
    });
    expect(buildDraftPayload(useChainsStore.getState(), "local_a", { meta: META })!.errors).toEqual(
      ["Поле name обязательно"],
    );
  });
});

describe("applyDraftPatch", () => {
  it("действия собирает как форма, связи не трогает, неизвестные поля отклоняет", () => {
    const full = draftBody({ conditions: [{ countries: { list: ["DE"] } }] });
    const patch = applyDraftPatch(full, [{ countries: { list: ["DE"] } }, GT], {
      serialized_main_actions: [{ action: "sport_bet", fields: { sport_bet_types: ["express"] } }],
      conditions: [{ registration_days: 3 }, GT],
      locales: { en: "Make a deposit" },
      id: 5,
      state: "active",
    });
    expect(patch.changed).toEqual(["serialized_main_actions", "conditions", "locales"]);
    expect(patch.rejected).toEqual(["id: поле нельзя менять", "state: поле нельзя менять"]);
    expect(patch.full.serialized_main_actions).toEqual([
      expect.objectContaining({ action: "sport_bet" }),
    ]);
    expect(patch.full.conditions).toEqual([{ registration_days: 3 }]);
    expect(patch.conditions).toEqual([{ registration_days: 3 }, GT]);
    expect(patch.full.locales).toEqual({ ru: "Сделай депозит", en: "Make a deposit" });
  });

  it("неизвестный тип действия — отказ, поле не меняется", () => {
    const patch = applyDraftPatch(draftBody(), [], {
      serialized_main_actions: [{ action: "fly_to_moon", fields: {} }],
    });
    expect(patch.changed).toEqual([]);
    expect(patch.rejected[0]).toMatch(/неизвестный тип действия/);
  });
});

describe("взгляд агента на черновик", () => {
  it("подсказки по брифу", () => {
    const source = draftBody({ _plannerPrerequisiteId: 3 });
    const task = { ...source, serialized_main_actions: [], available_till: null, locales: {} };
    expect(draftWarnings(task, source, false)).toEqual([
      "Нет целевых действий в основном блоке",
      "В брифе награда 50 pts, а основная группа бонусов не выбрана",
      "В брифе тег «Хэллоуин», а тег не выбран",
      "Не задана дата окончания (available_till)",
      "Нет названий на фронте (locales)",
      "В графике у задачи есть предшественник, а связи на канве нет",
    ]);
  });

  it("поля без служебного и пустого, действия плоскими полями; бриф отдельно", () => {
    const fields = fieldsForAgent({
      ...draftBody(),
      cross_project: false,
      tag: null,
      conditions: [],
    });
    expect(fields).not.toHaveProperty("_plannerTaskId");
    expect(fields).not.toHaveProperty("cross_project");
    expect(fields).not.toHaveProperty("conditions");
    expect(fields.serialized_main_actions).toEqual([
      { action: "deposit", label: "Депозит", fields: {} },
    ]);
    expect(briefForAgent(draftBody())).toMatchObject({
      planner_task_id: 77,
      general: "Награда 50 pts, депозит от 20 €",
      reward_points: 50,
    });
  });
});

describe("инструменты", () => {
  it("описания инструментов — function с объектом параметров", () => {
    expect(AGENT_TOOLS.map((t) => t.function.name)).toEqual([
      "list_drafts",
      "get_draft",
      "update_draft",
      "create_draft_on_backend",
      "get_reference",
      "list_packages",
      "open_package",
    ]);
    for (const t of AGENT_TOOLS) expect(t.function.parameters.type).toBe("object");
  });

  it("задачи с бэка и черновики вне выделения недоступны", async () => {
    await expect(runAgentTool(ctx(), "get_draft", { id: "10" })).rejects.toThrow(/уже на бэке/);
    await expect(runAgentTool(ctx(["local_b"]), "get_draft", { id: "local_a" })).rejects.toThrow(
      /не выделен/,
    );
    const list = (await runAgentTool(ctx(["local_b"]), "list_drafts", {})) as { drafts: unknown[] };
    expect(list.drafts).toEqual([expect.objectContaining({ id: "local_b" })]);
  });

  it("update_draft меняет карточку на канве и возвращает проверку", async () => {
    const result = (await runAgentTool(ctx(), "update_draft", {
      id: "local_a",
      fields: { name: "Депозит 20 €" },
    })) as { changed: string[]; validation: { errors: string[] } };
    expect(result.changed).toEqual(["name"]);
    expect(result.validation.errors).toEqual([]);
    const draft = useChainsStore.getState().canvas.local_a!;
    expect(draft.name).toBe("Депозит 20 €");
    expect(draft.full!.name).toBe("Депозит 20 €");
  });

  it("последователь ждёт предшественника; создание — draft, журнал agent, id на канве", async () => {
    await expect(runAgentTool(ctx(), "create_draft_on_backend", { id: "local_b" })).rejects.toThrow(
      /Сначала создайте предшественников \(local_a\)/,
    );
    createTask.mockResolvedValue({
      response: {},
      newId: 501,
      task: { id: 501, name: "Депозит", frontend_identifier: "deposit_20", conditions: [] },
    });
    const c = ctx();
    const result = await runAgentTool(c, "create_draft_on_backend", {
      id: "local_a",
      notes: "Бонус по награде 50 pts",
    });
    expect(result).toEqual({ ok: true, ph_backend_id: "501", name: "Депозит", state: "draft" });
    expect(createTask.mock.calls[0]![1].gamification_task.state).toBe("draft");
    expect(logTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "created",
        source: "agent",
        agent_run_id: "run-1",
        notes: "Бонус по награде 50 pts",
        ph_backend_id: 501,
        planner_task_id: 77,
      }),
    );
    expect(notifyGraphicBackendCreated).toHaveBeenCalledWith(77, 501);
    expect(c.onCreated).toHaveBeenCalledWith({ localId: "local_a", id: "501", name: "Депозит" });
    const state = useChainsStore.getState();
    expect(state.canvas.local_a).toBeUndefined();
    expect(state.canvas["501"]!.localOnly).toBeUndefined();
    expect(state.edges).toContainEqual({ from: "501", to: "local_b" });
  });

  it("с ошибками схемы на бэк не уходит", async () => {
    const state = useChainsStore.getState();
    useChainsStore.setState({
      canvas: {
        ...state.canvas,
        local_a: card("local_a", { localOnly: true, full: draftBody({ name: "" }) }),
      },
    });
    const result = await runAgentTool(ctx(), "create_draft_on_backend", {
      id: "local_a",
      notes: "",
    });
    expect(result).toEqual({ ok: false, errors: ["Поле name обязательно"] });
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("цикл агента", () => {
  function step(message: AgentStepReply["message"]): AgentStepReply {
    return { message, model: "m", finish_reason: null };
  }

  it("вызывает инструменты, отдаёт результаты модели и заканчивает текстом", async () => {
    agentStep
      .mockResolvedValueOnce(
        step({
          role: "assistant",
          content: "Посмотрю черновики",
          tool_calls: [
            { id: "c1", type: "function", function: { name: "list_drafts", arguments: "{}" } },
            { id: "c2", type: "function", function: { name: "nope", arguments: "{}" } },
          ],
        }),
      )
      .mockResolvedValueOnce(step({ role: "assistant", content: "- Готово" }));

    await runAgent({ goal: "Создай черновики", ensureAuthenticated: async () => true });

    const second = agentStep.mock.calls[1]![0] as { messages: AgentMessage[]; run_id: string };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(second.messages[0]!.content).toMatch(/Область работы: все локальные черновики/);
    const toolMessages = second.messages.filter((m) => m.role === "tool");
    expect(JSON.parse(toolMessages[0]!.content).drafts).toHaveLength(2);
    expect(JSON.parse(toolMessages[1]!.content)).toEqual({ error: "Нет инструмента nope" });

    const { entries, running } = useAgentPanel.getState();
    expect(running).toBe(false);
    expect(entries.map((e) => e.kind)).toEqual(["goal", "thought", "tool", "tool", "answer"]);
    expect(finishAgentRun).toHaveBeenCalledWith(second.run_id, "done", "- Готово", null);
  });

  it("выделенные черновики ограничивают область; стоп — после текущего шага", async () => {
    useChainsStore.setState({ selectedIds: ["local_b", "10"] });
    agentStep.mockImplementation(async () => {
      useAgentPanel.getState().requestStop();
      return step({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "list_drafts", arguments: "{}" } },
        ],
      });
    });
    await runAgent({ goal: "Создай", ensureAuthenticated: async () => true });
    expect(agentStep).toHaveBeenCalledTimes(1);
    const first = agentStep.mock.calls[0]![0] as { messages: AgentMessage[] };
    expect(first.messages[0]!.content).toMatch(/только выделенные черновики: local_b/);
    expect(finishAgentRun.mock.calls[0]![1]).toBe("stopped");
  });

  it("сбой шага — ошибка в ленте и failed в журнале", async () => {
    agentStep.mockRejectedValue(new Error("OpenRouter вернул 500"));
    await runAgent({ goal: "Создай", ensureAuthenticated: async () => true });
    expect(useAgentPanel.getState().entries.at(-1)).toMatchObject({
      kind: "error",
      text: "OpenRouter вернул 500",
    });
    expect(finishAgentRun.mock.calls[0]!.slice(1)).toEqual([
      "failed",
      null,
      "OpenRouter вернул 500",
    ]);
  });
});

describe("помощники цикла", () => {
  it("аргументы, обрезка и итог вызова", () => {
    expect(parseToolArgs('{"id":"local_a"}')).toEqual({ id: "local_a" });
    expect(parseToolArgs("[1]")).toBeNull();
    expect(parseToolArgs("{oops")).toBeNull();
    expect(toolResultText({ a: "x".repeat(50_000) })).toMatch(/обрезано/);
    expect(toolOutcome("create_draft_on_backend", { ok: true, ph_backend_id: "9" })).toEqual({
      status: "ok",
      detail: "Создана #9 (черновик)",
      taskId: "9",
    });
    expect(toolOutcome("create_draft_on_backend", { ok: false, errors: ["name: пусто"] })).toEqual({
      status: "error",
      detail: "name: пусто",
    });
    expect(toolOutcome("update_draft", { rejected: ["id: нельзя"] }).status).toBe("error");
    expect(toolOutcome("list_drafts", { drafts: [] })).toEqual({ status: "ok" });
  });
});
