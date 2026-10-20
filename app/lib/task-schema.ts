/**
 * Zod-схема тела gamification_task для POST create / PATCH.
 * Описывает, что расширение отправляет на бэк, и правило для цепочек (type: "sequence"):
 * у них нет событий, таргетинга, расписания, дат, лимита повторов, стран и кампании.
 */
import { z } from "zod";

import { SEQUENCE_TASK_TYPE } from "./constants";

export const taskTypeSchema = z.enum(["interactive", "informational", "achievement", "sequence"]);

export const taskActionSchema = z.object({
  action: z.string().min(1),
  requirements: z.record(z.string(), z.unknown()).optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
});

export const taskTagSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  cross_project: z.boolean(),
  shared_projects: z.array(z.unknown()),
});

const idLike = z.union([z.number(), z.string()]);
const nullableString = z.string().nullable();

export const taskPayloadSchema = z
  .object({
    name: z.string().trim().min(1, "Поле name обязательно"),
    frontend_identifier: z.string().trim().min(1, "Поле frontend_identifier обязательно"),
    type: taskTypeSchema,
    hidden: z.boolean(),
    state: z.string(),
    locales: z.record(z.string(), z.string()),
    player_consent_required: z.boolean().optional(),
    category: nullableString.optional(),
    priority: z.number().int().optional(),
    tag_id: idLike.nullable().optional(),
    tag: taskTagSchema.nullable().optional(),
    filter_id: idLike.nullable().optional(),
    events: z.array(z.string()),
    repeatable: z.boolean().optional(),
    cron: nullableString.optional(),
    available_from: nullableString.optional(),
    available_till: nullableString.optional(),
    max_repetitions: z.number().int().nullable().optional(),
    duration: z.number().nullable().optional(),
    infinite: z.boolean(),
    countries: z.array(z.string()),
    countries_lists: z.array(z.unknown()),
    countries_matching_type: nullableString.optional(),
    conditions: z.array(z.record(z.string(), z.unknown())),
    serialized_main_actions: z.array(taskActionSchema),
    serialized_secondary_actions: z.array(taskActionSchema),
    main_actions_sequential: z.boolean().optional(),
    secondary_actions_sequential: z.boolean().optional(),
    main_bonus_group_id: nullableString.optional(),
    secondary_bonus_group_id: nullableString.optional(),
    notification_events: z.array(z.string()),
  })
  .superRefine((task, ctx) => {
    if (task.type !== SEQUENCE_TASK_TYPE) return;
    const mustBeEmpty: Array<[keyof typeof task, boolean]> = [
      ["events", task.events.length === 0],
      ["conditions", task.conditions.length === 0],
      ["countries", task.countries.length === 0],
      ["countries_lists", task.countries_lists.length === 0],
      ["category", task.category == null],
      ["cron", task.cron == null],
      ["repeatable", !task.repeatable],
      ["available_from", task.available_from == null],
      ["available_till", task.available_till == null],
      ["max_repetitions", task.max_repetitions == null],
      ["countries_matching_type", task.countries_matching_type == null],
    ];
    for (const [field, ok] of mustBeEmpty) {
      if (ok) continue;
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `У цепочки (type: sequence) поле ${String(field)} должно быть пустым`,
      });
    }
  });

export type TaskPayload = z.infer<typeof taskPayloadSchema>;

/** Проверяет payload; возвращает список сообщений об ошибках (пусто — всё хорошо). */
export function validateTaskPayload(payload: unknown): string[] {
  const result = taskPayloadSchema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) =>
    issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}
