import { renameActionKeysForApi } from "@/lib/actions-schema";

/**
 * Поля, которые новый payload шлёт как админка, а старое расширение не слало.
 * Тесты паритета сравнивают всё остальное.
 */
export const PAYLOAD_KEYS_ADDED_IN_V3 = [
  "manual_reward",
  "cross_project",
  "shared_projects",
] as const;

export function withoutV3Keys<T extends Record<string, unknown>>(
  payload: T,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...payload };
  for (const key of PAYLOAD_KEYS_ADDED_IN_V3) delete copy[key];
  return copy;
}

/**
 * Payload старого кода с ключами действий, как их теперь шлёт v3:
 * «Тип ставки» sport_bet старый код отправлял как sport_bet_types, бэк читает `types`.
 */
export function withApiActionKeys<T extends Record<string, unknown>>(payload: T): T {
  const copy: Record<string, unknown> = { ...payload };
  for (const key of ["serialized_main_actions", "serialized_secondary_actions"]) {
    const list = copy[key];
    if (Array.isArray(list)) {
      copy[key] = list.map((item) => renameActionKeysForApi(item as Record<string, unknown>));
    }
  }
  return copy as T;
}
