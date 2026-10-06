/** Ключи chrome.storage.local и общие константы расширения. */

export const STORAGE_KEYS = {
  DOMAINS: "ph_admin_domains",
  AUTH_SESSIONS: "ph_auth_sessions",
  REQUESTS: "ph_captured_requests",
  CAPTURE_ENABLED: "ph_capture_enabled",
  MAX_REQUESTS: "ph_max_requests",
  CANVAS_TEMPLATES: "ph_canvas_templates",
  GRAPHIC_AUTH: "ph_graphic_auth",
  GRAPHIC_BASE_URL: "ph_graphic_base_url",
};

/** Cookie сессии PromoHub admin (Rails). */
export const ADMIN_SESSION_COOKIE = "_casino_session";

export const ADMIN_API_PREFIX = "/admin/api";
export const ADMIN_AUTH_LOCALE = "ru";

/** Максимум шаблонов канвы на один домен. */
export const MAX_CANVAS_TEMPLATES_PER_DOMAIN = 20;

export const DEFAULT_DOMAIN = "admin.crimson.lex.prd.maxbit.private";
export const DEFAULT_MAX_REQUESTS = 500;
export const PAGE_SIZE = 50;
export const LAYOUT_KEY_PREFIX = "ph_chains_layout_";

/** Статусы задач, показываемые в списках editor/chains. */
export const VISIBLE_TASK_STATES = new Set(["active", "draft"]);

export const KIND_LABELS = {
  create: "CREATE",
  copy: "COPY",
  edit: "EDIT",
  fetch_one: "FETCH ONE",
  fetch_list: "FETCH LIST",
};

export const READONLY_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
]);

/** Поля gamification_task для POST create / PATCH. */
export const CREATE_TASK_KEYS = [
  "available_from",
  "available_till",
  "category",
  "conditions",
  "countries",
  "countries_lists",
  "countries_matching_type",
  "cron",
  "duration",
  "events",
  "filter_id",
  "frontend_identifier",
  "hidden",
  "infinite",
  "locales",
  "main_actions_sequential",
  "main_bonus_group_id",
  "max_repetitions",
  "name",
  "notification_events",
  "player_consent_required",
  "priority",
  "repeatable",
  "secondary_actions_sequential",
  "secondary_bonus_group_id",
  "serialized_main_actions",
  "serialized_secondary_actions",
  "state",
  "tag",
  "tag_id",
  "type",
];

export const CREATE_TASK_KEY_SET = new Set(CREATE_TASK_KEYS);

/** Поля из GET, которые нельзя отправлять при POST create. */
export const STRIP_FROM_CREATE = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
  "enabled",
  "event",
  "tags",
  "condition_groups",
  "dsl_tags",
  "filter",
  "main_actions",
  "secondary_actions",
  "locale",
  "locales_list",
  "_plannerNote",
  "_plannerHints",
  "_plannerTaskId",
  "_plannerPrerequisiteId",
]);

export const CONTENT_SCRIPT_PATH = "src/inject/content.js";
