import { describe, expect, it, vi } from "vitest";

const graphicApiGet = vi.fn();
const graphicApiPost = vi.fn();
const graphicApiPut = vi.fn();
vi.mock("@/lib/graphic-api", () => ({
  graphicApiGet: (...args: unknown[]) => graphicApiGet(...args),
  graphicApiPost: (...args: unknown[]) => graphicApiPost(...args),
  graphicApiPut: (...args: unknown[]) => graphicApiPut(...args),
}));

import {
  CONTEXT_LIMIT,
  type CanvasSnapshotState,
  askCanvasAssistant,
  buildCanvasContext,
  compactValue,
  contextSize,
  formatFeedback,
  rateAssistantAnswer,
  loadAssistantPrompt,
  promptVersionLabel,
  saveAssistantPrompt,
} from "@/features/chains/assistant";
import type { CanvasTask } from "@/features/chains/graph";

function card(id: string, full: Record<string, unknown> | null, extra: Partial<CanvasTask> = {}) {
  return {
    id,
    name: String(full?.name ?? id),
    frontend_identifier: "",
    conditions: (full?.conditions as CanvasTask["conditions"]) ?? [],
    full,
    x: 0,
    y: 0,
    ...extra,
  } satisfies CanvasTask;
}

function state(): CanvasSnapshotState {
  return {
    canvas: {
      "10": card("10", {
        id: 10,
        name: "Депозит",
        type: "interactive",
        category: "basic",
        events: ["deposit"],
        serialized_main_actions: [{ action: "deposit", requirements: { payments_count: 1 } }],
        main_bonus_group_id: "gamification_award:Free spins 50",
        tag_id: null,
        countries: [],
        created_at: "2026-01-01",
        hidden: false,
        conditions: [],
      }),
      "20": card(
        "20",
        { id: 20, name: "Ставки", type: "interactive", conditions: [] },
        // На канве уже добавлена связь от #10 и от задачи вне канвы #99 — ещё не сохранено.
        {
          conditions: [
            {
              gamification_tasks: {
                list: ["10", "99"],
                type: "enabled",
                extra_type: "or",
                only_completed: true,
              },
            },
          ],
        },
      ),
      local_ab: card(
        "local_ab",
        { name: "Черновик", _plannerNote: "из графика" },
        { localOnly: true },
      ),
    },
    edges: [{ from: "10", to: "20" }],
    targetConfigs: {},
    dirtyTargets: ["20"],
  };
}

describe("compactValue", () => {
  it("drops empty values and timestamps but keeps false and 0", () => {
    expect(
      compactValue({ a: null, b: "", c: [], d: {}, e: false, f: 0, g: [null], updated_at: "x" }),
    ).toEqual({ e: false, f: 0 });
  });
});

describe("buildCanvasContext", () => {
  it("snapshots canvas state: unsaved links, drafts, off-canvas refs, focus", () => {
    const ctx = buildCanvasContext(state(), ["20", "missing"]);
    const byId = Object.fromEntries(ctx.tasks.map((t) => [t.id, t]));

    expect(byId["20"]).toMatchObject({ on_backend: true, unsaved_links: true });
    expect(JSON.stringify(byId["20"]!.conditions)).toContain('"99"');
    expect(byId["local_ab"]).toMatchObject({ on_backend: false, _plannerNote: "из графика" });
    expect(byId["10"]).not.toHaveProperty("created_at");
    expect(byId["10"]).not.toHaveProperty("countries");
    expect(byId["10"]!.hidden).toBe(false);
    expect(ctx.off_canvas_ids).toEqual(["99"]);
    expect(ctx.focus_ids).toEqual(["20"]);
    expect(ctx.links).toEqual([
      { from: "10", to: "20", type: "enabled", extra_type: "or", only_completed: true },
    ]);
  });

  it("glossary holds labels only for codes present on the canvas", () => {
    const ctx = buildCanvasContext(state(), [], {
      meta: {
        events: [],
        filters: [],
        tags: [],
        bonuses: [{ id: "gamification_award:Free spins 50", title: "50 фриспинов" }],
        notification_events: [],
        dsl_tags: [],
        categories: [],
        types: [],
        priorities: [],
      },
    });
    const g = ctx.glossary as Record<string, Record<string, unknown>>;
    expect(g.actions).toEqual({ deposit: "Депозит" });
    expect(g.events).toEqual({ deposit: "Депозит" });
    expect(g.task_types).toEqual({ interactive: "Интерактивное" });
    expect(g.bonus_groups).toEqual({ "gamification_award:Free spins 50": "50 фриспинов" });
    expect(g.action_fields).toHaveProperty("payments_count");
    expect(g).not.toHaveProperty("tags");
  });

  it("keeps focused tasks full and indexes the rest when the canvas is too big", () => {
    const big = state();
    big.canvas["10"]!.full!.description = "x".repeat(CONTEXT_LIMIT);
    const ctx = buildCanvasContext(big, ["20"]);
    const byId = Object.fromEntries(ctx.tasks.map((t) => [t.id, t]));
    expect(byId["10"]).toMatchObject({ detail: "index", name: "Депозит" });
    expect(byId["20"]).not.toHaveProperty("detail");
    expect(contextSize(ctx)).toBeLessThan(CONTEXT_LIMIT);
    // Без выделения урезать нечем — снимок остаётся полным, панель сама скажет выделить задачи.
    expect(contextSize(buildCanvasContext(big, []))).toBeGreaterThan(CONTEXT_LIMIT);
  });
});

describe("askCanvasAssistant", () => {
  it("normalizes the reply", async () => {
    graphicApiPost.mockResolvedValue({
      answer: "#10 — депозит",
      model: "m",
      unknown_refs: [5],
      prompt_version_id: 3,
    });
    const ctx = buildCanvasContext(state(), []);
    const reply = await askCanvasAssistant({
      question: "?",
      history: [],
      context: ctx,
      domain: "d",
    });
    expect(reply).toEqual({
      answer: "#10 — депозит",
      model: "m",
      unknown_refs: ["5"],
      log_id: null,
      prompt_version_id: 3,
    });
    expect(graphicApiPost.mock.calls[0]![0]).toBe("/api/promohub-planner/assistant/ask");
  });
});

describe("assistant prompt", () => {
  it("loads and saves instructions through the planner API", async () => {
    const state = { current: { id: 2, content: "x" }, default: "d", versions: [] };
    graphicApiGet.mockResolvedValue(state);
    graphicApiPut.mockResolvedValue(state);
    expect(await loadAssistantPrompt()).toBe(state);
    await saveAssistantPrompt("Новый текст", "короче");
    expect(graphicApiPut).toHaveBeenCalledWith("/api/promohub-planner/assistant/prompt", {
      content: "Новый текст",
      comment: "короче",
    });
  });

  it("labels versions", () => {
    expect(promptVersionLabel(null)).toBe("встроенные инструкции");
    expect(promptVersionLabel(4)).toBe("инструкции №4");
  });
});

describe("answer feedback", () => {
  it("formats reasons and comment into the rating comment", () => {
    expect(
      formatFeedback({ reasons: ["Выдумал данные", "Плохо оформлено"], text: "  нет #900  " }),
    ).toBe(["Причины: Выдумал данные; Плохо оформлено", "Комментарий: нет #900"].join("\n"));
    expect(formatFeedback({ reasons: [], text: "только текст" })).toBe("Комментарий: только текст");
    expect(formatFeedback({ reasons: [], text: "   " })).toBeNull();
  });

  it("sends rating with comment; plain rating clears the comment", async () => {
    graphicApiPut.mockResolvedValue({ rated: true });
    await rateAssistantAnswer(7, -1, "Причины: Выдумал данные");
    await rateAssistantAnswer(7, 1);
    expect(graphicApiPut.mock.calls).toEqual([
      [
        "/api/promohub-planner/assistant/answers/7/rating",
        { rating: -1, comment: "Причины: Выдумал данные" },
      ],
      ["/api/promohub-planner/assistant/answers/7/rating", { rating: 1, comment: null }],
    ]);
  });
});
