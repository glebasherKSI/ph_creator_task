/**
 * Русские подписи для полей формы копирования и билдеров.
 * Источники: panel_backend.js gamification_tasks (ru), meta.json, conditions.json labels.
 */

/** @type {Record<string, string>} */
const EVENT_LABELS = {
  bonus_issued: "Выдан бонус",
  cashout: "Вывод средств",
  deposit: "Депозит",
  email_confirmation: "Подтверждение e-mail",
  groups_updated: "Обновление групп",
  registration: "Регистрация",
  scheduler: "Расписание",
  sport_bonus_issued: "Выдан спортивный бонус",
  task_completed: "Выполненное задание",
};

/** @type {Record<string, string>} */
const NOTIFICATION_EVENT_LABELS = {
  expire: "Задание провалено",
  issue: "Игроку назначено задание",
  main_bonus_issue: "Основная награда получена",
  secondary_actions_done: "Выполнено дополнительное задание",
  secondary_bonus_issue: "Дополнительная награда получена",
  start: "Игрок начал выполнять задание",
};

/** @type {Record<string, string>} */
const TYPE_LABELS = {
  achievement: "Достижения",
  informational: "Информационное",
  interactive: "Интерактивное",
};

/** @type {Record<string, string>} */
const CATEGORY_LABELS = {
  basic: "Базовое",
  beginning: "Стартовое",
  passive: "Пассивное",
  progressive: "Прогрессивное",
  sequence: "Цепочка",
};

/** @type {Record<number, string>} */
const PRIORITY_LABELS = {
  0: "Самый низкий",
  1: "Низкий",
  2: "Средний",
  3: "Высокий",
  4: "Наивысший",
};

/** @type {Record<string, string>} */
const ACTION_TYPE_LABELS = {
  achievement: "Достижения",
  app_login: "Логин из мобильного приложения",
  bet: "Ставки казино",
  bonus_issue: "Получение бонуса",
  cashout: "Вывод средств",
  deposit: "Депозит",
  email_confirmation: "Подтверждение email",
  gamification_task: "Задания",
  groups_update: "Присвоение группы",
  leaderboard: "Попасть в лидерборд",
  phone_confirmation: "Подтверждение телефона",
  scratch_card: "Скретч-карта",
  sport_bet: "Ставки на спорт",
  tournament: "Участие в турнире",
  two_factor: "Включение 2FA",
  user_update: "Заполнение профиля",
};

/** @type {Map<string, string> | null} */
let conditionLabelsByName = null;

/**
 * @param {import("./conditions-schema.js").ParsedConditionsSchema | null} schema
 */
export function setConditionsLabelSchema(schema) {
  conditionLabelsByName = null;
  if (!schema?.byName) return;
  conditionLabelsByName = new Map();
  for (const [name, def] of schema.byName.entries()) {
    if (def?.label) conditionLabelsByName.set(name, def.label);
  }
}

/** @param {string} key */
export function eventLabel(key) {
  return EVENT_LABELS[String(key)] ?? String(key);
}

/** @param {string} key */
export function notificationEventLabel(key) {
  return NOTIFICATION_EVENT_LABELS[String(key)] ?? String(key);
}

/** @param {string} key */
export function typeLabel(key) {
  return TYPE_LABELS[String(key)] ?? String(key);
}

/** @param {string} key */
export function categoryLabel(key) {
  return CATEGORY_LABELS[String(key)] ?? String(key);
}

/** @param {number | string} key */
export function priorityLabel(key) {
  const num = Number(key);
  return PRIORITY_LABELS[num] ?? String(key);
}

/** @param {string} key */
export function actionTypeLabel(key) {
  return ACTION_TYPE_LABELS[String(key)] ?? String(key);
}

/**
 * @param {string} key
 * @param {{ label?: string } | null} [def]
 */
export function conditionLabel(key, def = null) {
  if (def?.label) return def.label;
  return conditionLabelsByName?.get(String(key)) ?? String(key);
}

/** @param {boolean | string | null | undefined} value */
export function playerConsentLabel(value) {
  if (value === true || value === "true" || value === "1") return "Да";
  return "Нет";
}

/** @param {string} key */
export function dslTagLabel(key) {
  return String(key).replace(/_/g, " ");
}

/**
 * @param {string[]} values
 * @param {(key: string) => string} labelFn
 */
export function toLabeledOptions(values, labelFn) {
  return (values || []).map((value) => ({
    value: String(value),
    label: labelFn(String(value)),
  }));
}
