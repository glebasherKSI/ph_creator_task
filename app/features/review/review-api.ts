/** Ревью задач агента и уроки для него — хранятся в Promo Graphic рядом с журналом задач. */
import { graphicApiGet, graphicApiPost, graphicApiPut } from "@/lib/graphic-api";
import type { TaskLike } from "@/lib/types";

const AGENT = "/api/promohub-planner/agent";

export type ReviewStatus = "approved" | "fixed" | "rejected";
export type ReviewFilter = "pending" | "reviewed" | "all";

/** Поле, которое человек поправил после агента: подписи и значения — как их видит человек. */
export interface ReviewDiffEntry {
  key: string;
  label: string;
  section: string;
  agent: string;
  human: string;
}

export interface AgentReviewItem {
  /** id события журнала «создано агентом». */
  id: number;
  domain: string | null;
  ph_backend_id: string | null;
  planner_task_id: number | null;
  /** Задание графика в момент создания (снимок бэка). */
  planner_task: Record<string, unknown> | null;
  /** Черновик до создания — с брифом (_planner*). */
  draft: TaskLike | null;
  payload: { gamification_task: TaskLike } | null;
  /** Задача, как её сохранила админка сразу после создания. */
  result: TaskLike | null;
  notes: string | null;
  agent_run_id: string | null;
  created_at: string | null;
  run_goal: string | null;
  run_summary: string | null;
  run_model: string | null;
  review_status: ReviewStatus | null;
  review_reasons: string[];
  review_comment: string | null;
  review_diff: ReviewDiffEntry[];
  reviewer: string | null;
  reviewed_at: string | null;
}

export interface ReviewCounts {
  pending: number;
  reviewed: number;
}

export async function listAgentReviews(
  domain: string,
  status: ReviewFilter,
): Promise<{ items: AgentReviewItem[]; counts: ReviewCounts }> {
  const data = (await graphicApiGet(`${AGENT}/reviews`, { domain, status, limit: 200 })) as {
    items?: AgentReviewItem[];
    counts?: Partial<ReviewCounts>;
  } | null;
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    counts: { pending: data?.counts?.pending ?? 0, reviewed: data?.counts?.reviewed ?? 0 },
  };
}

export async function saveAgentReview(
  eventId: number,
  review: { status: ReviewStatus; reasons: string[]; comment: string; diff: ReviewDiffEntry[] },
): Promise<void> {
  await graphicApiPut(`${AGENT}/reviews/${eventId}`, review);
}

export interface AgentLesson {
  id: number;
  text: string;
  source_event_id: number | null;
  active: boolean;
  author: string | null;
  created_at: string | null;
}

export async function listAgentLessons(): Promise<AgentLesson[]> {
  const data = (await graphicApiGet(`${AGENT}/lessons`)) as { items?: AgentLesson[] } | null;
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createAgentLesson(text: string, sourceEventId: number | null): Promise<void> {
  await graphicApiPost(`${AGENT}/lessons`, { text, source_event_id: sourceEventId });
}

export async function updateAgentLesson(
  id: number,
  patch: { text?: string; active?: boolean },
): Promise<void> {
  await graphicApiPut(`${AGENT}/lessons/${id}`, patch);
}
