/**
 * Русские подписи для полей формы задачи и билдеров.
 * Источники: panel_backend.js gamification_tasks (ru), meta.json, conditions.json labels.
 */

const EVENT_LABELS: Record<string, string> = {
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

const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  expire: "Задание провалено",
  issue: "Игроку назначено задание",
  main_bonus_issue: "Основная награда получена",
  secondary_actions_done: "Выполнено дополнительное задание",
  secondary_bonus_issue: "Дополнительная награда получена",
  start: "Игрок начал выполнять задание",
};

const TYPE_LABELS: Record<string, string> = {
  achievement: "Достижения",
  informational: "Информационное",
  interactive: "Интерактивное",
  sequence: "Цепочка",
};

const CATEGORY_LABELS: Record<string, string> = {
  basic: "Базовое",
  beginning: "Стартовое",
  passive: "Пассивное",
  progressive: "Прогрессивное",
  sequence: "Цепочка",
};

const PRIORITY_LABELS: Record<number, string> = {
  0: "Самый низкий",
  1: "Низкий",
  2: "Средний",
  3: "Высокий",
  4: "Наивысший",
};

const ACTION_TYPE_LABELS: Record<string, string> = {
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

let conditionLabelsByName: Map<string, string> | null = null;

/** Подписи условий из схемы /admin/api/filters/conditions (byName → label). */
export function setConditionsLabelSchema(
  schema: { byName?: Map<string, { label?: string } | null> } | null,
): void {
  conditionLabelsByName = null;
  if (!schema?.byName) return;
  conditionLabelsByName = new Map();
  for (const [name, def] of schema.byName.entries()) {
    if (def?.label) conditionLabelsByName.set(name, def.label);
  }
}

export function eventLabel(key: string): string {
  return EVENT_LABELS[String(key)] ?? String(key);
}

export function notificationEventLabel(key: string): string {
  return NOTIFICATION_EVENT_LABELS[String(key)] ?? String(key);
}

export function typeLabel(key: string): string {
  return TYPE_LABELS[String(key)] ?? String(key);
}

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[String(key)] ?? String(key);
}

export function priorityLabel(key: number | string): string {
  const num = Number(key);
  return PRIORITY_LABELS[num] ?? String(key);
}

export function actionTypeLabel(key: string): string {
  return ACTION_TYPE_LABELS[String(key)] ?? String(key);
}

export function conditionLabel(key: string, def: { label?: string } | null = null): string {
  if (def?.label) return def.label;
  return conditionLabelsByName?.get(String(key)) ?? String(key);
}

export function playerConsentLabel(value: boolean | string | null | undefined): string {
  if (value === true || value === "true" || value === "1") return "Да";
  return "Нет";
}

export function dslTagLabel(key: string): string {
  return String(key).replace(/_/g, " ");
}

export interface LabeledOption {
  value: string;
  label: string;
}

export function toLabeledOptions(
  values: ReadonlyArray<string | number> | null | undefined,
  labelFn: (key: string) => string,
): LabeledOption[] {
  return (values || []).map((value) => ({
    value: String(value),
    label: labelFn(String(value)),
  }));
}
