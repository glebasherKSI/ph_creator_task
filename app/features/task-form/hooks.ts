/** Справочники для формы задачи: meta (типы, теги, бонусы…) и схема условий. */
import { useCallback, useEffect, useState } from "react";

import {
  type ParsedConditionsSchema,
  loadConditionsSchema,
  loadDuplicableOptions,
} from "@/lib/conditions-schema";
import { type ParsedTaskMeta, loadTaskMeta } from "@/lib/meta";

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0] ?? message;
}

/**
 * GET tasks/meta для домена. Без домена — `data: null` и `error` с подсказкой
 * (форма переходит в режим ручного ввода, как раньше).
 */
export function useTaskMeta(domain: string): AsyncResource<ParsedTaskMeta> {
  const [state, setState] = useState<{
    domain: string;
    data: ParsedTaskMeta | null;
    error: string | null;
  }>({ domain: "", data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  const key = domain.trim();
  const loading = key !== "" && state.domain !== key;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadTaskMeta(key).then(
      (data) => !cancelled && setState({ domain: key, data, error: null }),
      (err: unknown) => !cancelled && setState({ domain: key, data: null, error: errorText(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  if (!key) {
    return {
      data: null,
      loading: false,
      error: "Домен не выбран — поля справочников в режиме ввода вручную",
      reload,
    };
  }
  return {
    data: state.domain === key ? state.data : null,
    loading,
    error: state.domain === key ? state.error : null,
    reload,
  };
}

export interface ConditionsSchemaResource extends AsyncResource<ParsedConditionsSchema> {
  duplicable: Set<string> | null;
}

/** Схема условий таргетинга + список дублируемых условий; без домена — фикстура. */
export function useConditionsSchema(domain: string): ConditionsSchemaResource {
  const [state, setState] = useState<{
    domain: string | null;
    data: ParsedConditionsSchema | null;
    duplicable: Set<string> | null;
    error: string | null;
  }>({ domain: null, data: null, duplicable: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  const key = domain.trim();
  const ready = state.domain === key;

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadConditionsSchema(key), loadDuplicableOptions(key)]).then(
      ([data, duplicable]) =>
        !cancelled && setState({ domain: key, data, duplicable, error: null }),
      (err: unknown) =>
        !cancelled &&
        setState({ domain: key, data: null, duplicable: null, error: errorText(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    data: ready ? state.data : null,
    duplicable: ready ? state.duplicable : null,
    loading: !ready,
    error: ready ? state.error : null,
    reload,
  };
}
