import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentReviewItem } from "@/features/review/review-api";
import type { TaskLike } from "@/lib/types";

const graphicApiGet = vi.fn();
const graphicApiPost = vi.fn();
const graphicApiPut = vi.fn();
vi.mock("@/lib/graphic-api", () => ({
  graphicApiGet: (...args: unknown[]) => graphicApiGet(...args),
  graphicApiPost: (...args: unknown[]) => graphicApiPost(...args),
  graphicApiPut: (...args: unknown[]) => graphicApiPut(...args),
}));

const {
  agentTaskOf,
  briefOf,
  buildReviewRows,
  isTargetingRow,
  lessonDraft,
  reviewDiff,
  reviewSections,
  verdictStatus,
} = await import("@/features/review/review");
const { createAgentLesson, listAgentReviews, saveAgentReview, updateAgentLesson } =
  await import("@/features/review/review-api");

const AGENT_TASK: TaskLike = {
  id: 501,
  name: "Депозит",
  frontend_identifier: "deposit_20",
  type: "interactive",
  locales: { ru: "Сделай депозит", en: "" },
  priority: 2,
  main_bonus_group_id: "1:GAMIFICATION BONUS POINTS 10",
  serialized_main_actions: [{ action: "deposit", requirements: {}, conditions: {} }],
  conditions: [],
};

function item(extra: Partial<AgentReviewItem> = {}): AgentReviewItem {
  return {
    id: 7,
    domain: "admin.example.com",
    ph_backend_id: "501",
    planner_task_id: 77,
    planner_task: null,
    draft: {
      name: "Депозит",
      _plannerHints: {
        sections: { rewards: [{ title: "Награда", body: "50 pts" }] },
        leftover: [{ title: "Прочее", body: "Запуск к Хэллоуину" }],
      },
    },
    payload: { gamification_task: { ...AGENT_TASK, id: undefined } },
    result: AGENT_TASK,
    notes: "Бонус не нашёл",
    agent_run_id: "run-1",
    created_at: "2026-10-29 14:05:00",
    run_goal: null,
    run_summary: null,
    run_model: null,
    review_status: null,
    review_reasons: [],
    review_comment: null,
    review_diff: [],
    reviewer: null,
    reviewed_at: null,
    ...extra,
  };
}

const ctx = {
  bonusTitle: (id: string) =>
    id.endsWith("50") ? "50 pts" : id.endsWith("10") ? "10 pts" : undefined,
};

beforeEach(() => {
  graphicApiGet.mockReset();
  graphicApiPost.mockReset();
  graphicApiPut.mockReset();
});

describe("строки ревью", () => {
  it("агент против текущей задачи: правки человека видны по секциям", () => {
    const current = {
      ...AGENT_TASK,
      name: "Депозит от 20 €",
      locales: { ru: "Сделай депозит", en: "Make a deposit" },
      main_bonus_group_id: "2:GAMIFICATION BONUS POINTS 50",
    };
    const rows = buildReviewRows(AGENT_TASK, current, ctx);
    const changed = rows.filter((r) => r.changed).map((r) => [r.key, r.agent, r.current]);
    expect(changed).toEqual([
      ["name", "Депозит", "Депозит от 20 €"],
      ["locale:en", "—", "Make a deposit"],
      ["main_bonus_group_id", "10 pts", "50 pts"],
    ]);
    expect(rows.find((r) => r.key === "locales")).toBeUndefined();
    expect(rows[0]!.section).toBe("basic");

    expect(reviewDiff(rows)).toEqual([
      {
        key: "name",
        label: "Название",
        section: "Основное",
        agent: "Депозит",
        human: "Депозит от 20 €",
      },
      {
        key: "locale:en",
        label: "Название на фронте (en)",
        section: "Основное",
        agent: "—",
        human: "Make a deposit",
      },
      expect.objectContaining({
        key: "main_bonus_group_id",
        section: "Вознаграждение",
        agent: "10 pts",
        human: "50 pts",
      }),
    ]);
  });

  it("таргетинг: false — «нет», отсутствие — «не задано», списки и связи текстом", () => {
    const withTargeting = {
      ...AGENT_TASK,
      conditions: [
        { no_bonus: false },
        { groups: { type: "enabled", list: ["ph_low", "vip"], extra_type: "or" } },
        {
          gamification_tasks: {
            list: ["1450"],
            type: "enabled",
            extra_type: "or",
            only_completed: true,
          },
        },
      ],
    };
    const current = { ...withTargeting, conditions: [{ no_bonus: false }] };
    const rows = buildReviewRows(withTargeting, current, ctx);
    const pick = (key: string) => rows.find((r) => r.key === key)!;
    expect(pick("condition:no_bonus")).toMatchObject({
      agent: "нет",
      current: "нет",
      changed: false,
    });
    expect(pick("condition:groups")).toMatchObject({
      agent: "Включая: ph_low, vip · любое",
      current: "не задано",
      changed: true,
    });
    expect(pick("gamification_tasks")).toMatchObject({
      section: "targeting",
      agent: "Включая: #1450 · только выполненные",
      current: "не задано",
    });
    expect(rows.filter(isTargetingRow).map((r) => r.key)).toEqual([
      "condition:groups",
      "condition:no_bonus",
      "gamification_tasks",
    ]);
  });

  it("без текущей задачи — только значения агента, правок нет", () => {
    const rows = buildReviewRows(AGENT_TASK, null, ctx);
    expect(rows.every((r) => r.current === null && !r.changed)).toBe(true);
    expect(reviewDiff(rows)).toEqual([]);
  });

  it("задача агента — ответ админки, иначе payload", () => {
    expect(agentTaskOf(item())).toBe(AGENT_TASK);
    expect(agentTaskOf(item({ result: null }))!.name).toBe("Депозит");
    expect(agentTaskOf(item({ result: null, payload: null }))).toBeNull();
  });

  it("бриф по секциям; секции в порядке формы, пустые (таргетинг) скрыты", () => {
    const brief = briefOf(item());
    expect(brief).toEqual({
      general: "Запуск к Хэллоуину",
      sections: { rewards: "50 pts" },
    });
    const sections = reviewSections(buildReviewRows(AGENT_TASK, null, ctx), brief);
    expect(sections.map((s) => s.id)).toEqual([
      "basic",
      "classification",
      "startup",
      "availability",
      "actions",
      "rewards",
      "notifications",
    ]);
    expect(sections.find((s) => s.id === "rewards")!.brief).toBe("50 pts");
  });
});

describe("вердикт и урок", () => {
  const diff = [
    {
      key: "main_bonus_group_id",
      label: "Осн. бонусы",
      section: "Вознаграждение",
      agent: "10 pts",
      human: "50 pts",
    },
  ];

  it("статус по правкам", () => {
    expect(verdictStatus([], false)).toBe("approved");
    expect(verdictStatus(diff, false)).toBe("fixed");
    expect(verdictStatus(diff, true)).toBe("rejected");
  });

  it("черновик урока: комментарий или причины, затем правки", () => {
    expect(lessonDraft(diff, "  Бонус — по награде из брифа ", [])).toBe(
      "Бонус — по награде из брифа Осн. бонусы: не «10 pts», а «50 pts».",
    );
    expect(lessonDraft(diff, "", ["Не тот бонус"])).toBe(
      "Не тот бонус. Осн. бонусы: не «10 pts», а «50 pts».",
    );
    expect(lessonDraft([], "", [])).toBe("");
    const long = [{ ...diff[0]!, human: "x".repeat(200) }];
    expect(lessonDraft(long, "", [])).toMatch(/x…»\.$/);
  });
});

describe("API ревью", () => {
  it("очередь, вердикт и уроки — пути и тела запросов", async () => {
    graphicApiGet.mockResolvedValue({ items: [item()], counts: { pending: 3 } });
    const list = await listAgentReviews("admin.example.com", "pending");
    expect(graphicApiGet).toHaveBeenCalledWith("/api/promohub-planner/agent/reviews", {
      domain: "admin.example.com",
      status: "pending",
      limit: 200,
    });
    expect(list.counts).toEqual({ pending: 3, reviewed: 0 });

    await saveAgentReview(7, { status: "fixed", reasons: ["Не тот бонус"], comment: "", diff: [] });
    expect(graphicApiPut).toHaveBeenCalledWith("/api/promohub-planner/agent/reviews/7", {
      status: "fixed",
      reasons: ["Не тот бонус"],
      comment: "",
      diff: [],
    });
    await createAgentLesson("Правило", 7);
    expect(graphicApiPost).toHaveBeenCalledWith("/api/promohub-planner/agent/lessons", {
      text: "Правило",
      source_event_id: 7,
    });
    await updateAgentLesson(3, { active: false });
    expect(graphicApiPut).toHaveBeenLastCalledWith("/api/promohub-planner/agent/lessons/3", {
      active: false,
    });
  });

  it("пустой ответ — пустая очередь", async () => {
    graphicApiGet.mockResolvedValue(null);
    expect(await listAgentReviews("d", "all")).toEqual({
      items: [],
      counts: { pending: 0, reviewed: 0 },
    });
  });
});
