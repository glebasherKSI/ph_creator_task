/**
 * Типы домена PromoHub gamification tasks.
 * Источник полей — ответы /admin/api/gamification/tasks (см. tests/fixtures/har).
 */

export type TaskType = "interactive" | "informational" | "achievement" | "sequence";

/** Известные состояния; бэк может прислать и другие — не сужаем до литералов. */
export type TaskState = "active" | "draft" | "archived" | (string & {});

export type CountriesMatchingType = "countries" | "countries_lists" | (string & {});

/** Одно условие таргетинга: `{ <name>: <value> }`. */
export type Condition = Record<string, unknown>;

/** Блок `gamification_tasks` в conditions — связи между задачами. */
export interface GamificationTasksCondition {
  list: string[];
  type: "enabled" | "disabled";
  extra_type: "and" | "or";
  /** Бэк не отдаёт поле, когда оно false. */
  only_completed?: boolean;
}

export interface TaskAction {
  action: string;
  requirements?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
}

/* Объектные типы ниже объявлены через `type`, а не `interface`: у type-литералов есть
 * неявная индексная сигнатура, и они совместимы с Record<string, unknown> (TaskLike). */

export type TaskTag = {
  id: number | string;
  name: string;
  settings: Record<string, unknown>;
  cross_project: boolean;
  shared_projects: unknown[];
};

export type GamificationTask = {
  id: number | string;
  name: string;
  locales: Record<string, string>;
  hidden: boolean;
  frontend_identifier: string;
  countries_lists: unknown[];
  countries_matching_type: CountriesMatchingType | null;
  type: TaskType;
  player_consent_required: boolean;
  repeatable: boolean;
  countries: string[];
  category: string | null;
  priority: number;
  tag_id: number | string | null;
  filter_id: number | string | null;
  events: string[];
  cron: string | null;
  max_repetitions: number | null;
  state: TaskState;
  duration: number | null;
  infinite?: boolean;
  available_from: string | null;
  available_till: string | null;
  serialized_main_actions: TaskAction[];
  serialized_secondary_actions: TaskAction[];
  main_actions_sequential: boolean;
  secondary_actions_sequential: boolean;
  main_bonus_group_id: string | null;
  secondary_bonus_group_id: string | null;
  manual_reward?: boolean;
  cancel_on_targeting_loss?: boolean;
  notification_events: string[];
  conditions: Condition[];
  cross_project?: boolean;
  shared_projects?: unknown[];
  tag?: TaskTag | null;
  created_at?: string;
  updated_at?: string;
  /** Служебные поля черновиков из графика (в payload не попадают). */
  _plannerNote?: string;
  _plannerHints?: unknown;
  _plannerTaskId?: number | string | null;
  _plannerPrerequisiteId?: number | string | null;
};

/**
 * Любой объект, похожий на задачу: с бэка, из формы, из черновика, из JSON-фикстуры.
 * Намеренно свободный — функции payload работают с произвольным набором полей.
 */
export type TaskLike = Record<string, unknown>;

export interface TaskListResponse {
  gamification_tasks?: GamificationTask[];
  tasks?: GamificationTask[];
  data?: GamificationTask[];
  items?: GamificationTask[];
  results?: GamificationTask[];
  pagination?: { total?: number; limit?: number; offset?: number };
}

/** Тело POST /admin/api/gamification/tasks и PATCH /…/tasks/:id. */
export interface TaskPayloadEnvelope {
  gamification_task: TaskLike;
}

export interface CapturedRequest {
  id: string;
  ts: number;
  kind: "create" | "copy" | "edit" | "fetch_one" | "fetch_list" | (string & {});
  method: string;
  url: string;
  host?: string;
  status?: number;
  requestBody?: unknown;
  responseBody?: unknown;
}
