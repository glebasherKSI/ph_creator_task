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
