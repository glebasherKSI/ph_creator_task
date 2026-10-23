/**
 * Форма задачи (копия / правка) — замена copy-panel.js.
 * Состояние формы — react-hook-form; все сложные поля — controlled-компоненты через Controller.
 */
import { ChevronDown, Info, Languages, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, type Resolver, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { MultiCombobox } from "@/components/multi-combobox";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimpleSelect } from "@/components/ui/select";
import { buildActionFieldOptionsFromConditionsSchema } from "@/lib/actions-schema";
import {
  categoryLabel,
  eventLabel,
  notificationEventLabel,
  priorityLabel,
  toLabeledOptions,
  typeLabel,
} from "@/lib/labels-ru";
import { lookupFrontTitles, mergeLocales } from "@/lib/front-titles";
import { DEFAULT_CATEGORIES, DEFAULT_PRIORITIES, DEFAULT_TASK_TYPES } from "@/lib/meta";
import { isSequenceType } from "@/lib/tasks";
import type { TaskLike, TaskPayloadEnvelope } from "@/lib/types";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { ActionsBuilder } from "./ActionsBuilder";
import { ConditionsBuilder, type TaskOption } from "./ConditionsBuilder";
import { CountrySelector, useCountriesData } from "./CountrySelector";
import { RepeatSchedule } from "./RepeatSchedule";
import { useConditionsSchema, useTaskMeta } from "./hooks";
import {
  type HintBox,
  KNOWN_LOCALE_CODES,
  SECTION_IDS,
  SECTION_TITLES,
  SEQUENCE_HIDDEN_SECTIONS,
  type SectionId,
  type TaskFormMode,
  type TaskFormValues,
  buildTaskPayload,
  emptyFormValues,
  eventsIncludeScheduler,
  findBonusIdByPoints,
  findTagIdByName,
  withPrerequisiteCondition,
  groupPlannerHints,
  taskToFormValues,
} from "./task-form";

export interface TaskFormProps {
  mode: TaskFormMode;
  domain: string;
  /** Исходная задача (копия) или редактируемая задача; null — форма пустая и неактивная. */
  sourceTask: TaskLike | null;
  /** Задачи для виджета gamification_tasks в таргетинге. */
  taskOptions?: ReadonlyArray<TaskOption>;
  /** Отправка собранного payload; возвращённое значение показывается в результате. */
  onSubmit: (payload: TaskPayloadEnvelope) => Promise<unknown>;
  showPreview?: boolean;
  title?: string;
  className?: string;
  /** Какие секции раскрыты при открытии (по умолчанию — «Основное»). */
  initialOpenSections?: ReadonlyArray<SectionId>;
  /** Ключ localStorage: раскрытые секции запоминаются между открытиями формы. */
  sectionsStorageKey?: string;
}

function readOpenSections(key: string | undefined): SectionId[] | null {
  if (!key) return null;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!Array.isArray(raw)) return null;
    return raw.filter((id): id is SectionId => SECTION_IDS.includes(id as SectionId));
  } catch {
    return null;
  }
}

function writeOpenSections(key: string | undefined, open: Record<SectionId, boolean>) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(SECTION_IDS.filter((id) => open[id])));
  } catch {
    /* хранилище недоступно — просто не запоминаем */
  }
}

const MODE_LABELS: Record<
  TaskFormMode,
  { title: string; sourceId: string; submit: string; submitting: string; preview: string }
> = {
  copy: {
    title: "Параметры копии",
    sourceId: "ID исходной задачи",
    submit: "Создать",
    submitting: "Создаю копию задачи...",
    preview: "Payload собран, можно создавать копию",
  },
  edit: {
    title: "Параметры задачи",
    sourceId: "ID задачи",
    submit: "Сохранить",
    submitting: "Сохранение...",
    preview: "Payload собран, можно сохранить",
  },
};

const requiredSchema = z
  .object({
    name: z.string().trim().min(1, "Поле name обязательно"),
    frontendIdentifier: z.string().trim().min(1, "Поле frontend_identifier обязательно"),
  })
  .loose();

const resolver = zodResolver(requiredSchema) as unknown as Resolver<TaskFormValues>;

/** Поля, которых нет у цепочек, внутри оставшихся секций. */
const SEQUENCE_HIDDEN_FIELDS = new Set([
  "countries",
  "category",
  "schedule",
  "availableFrom",
  "availableTill",
  "maxRepetitions",
]);

function Field({
  label,
  htmlFor,
  hint,
  wide,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", wide && "col-span-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <span className="text-caption text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function HintBadge({ hint }: { hint: HintBox }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-chip border border-primary px-1.5 text-caption font-semibold text-primary hover:bg-primary/10"
          onClick={(e) => e.stopPropagation()}
          aria-label="Бриф из графика"
        >
          <Info className="size-3" /> Бриф
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-caption font-semibold text-muted-foreground">{hint.title}</div>
        <pre className="text-subhead whitespace-pre-wrap">{hint.text}</pre>
      </PopoverContent>
    </Popover>
  );
}

function Section({
  id,
  open,
  onOpenChange,
  hint,
  children,
}: {
  id: SectionId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hint?: HintBox;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} data-section={id}>
      <div className="rounded-lg bg-surface">
        <div className="flex items-center gap-2 pr-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex flex-1 cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-headline outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {SECTION_TITLES[id]}
              <ChevronDown
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          {hint ? <HintBadge hint={hint} /> : null}
        </div>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function MetaNote({ text }: { text: string }) {
  return (
    <p className="rounded-md bg-surface-2/50 px-3 py-2 text-caption text-muted-foreground">
      {text}
    </p>
  );
}

export function TaskForm({
  mode,
  domain,
  sourceTask,
  taskOptions = [],
  onSubmit,
  showPreview = true,
  title,
  className,
  initialOpenSections = ["basic"],
  sectionsStorageKey,
}: TaskFormProps) {
  const labels = MODE_LABELS[mode];
  const meta = useTaskMeta(domain);
  const schema = useConditionsSchema(domain);
  const countries = useCountriesData(domain);

  const form = useForm<TaskFormValues>({ defaultValues: emptyFormValues(), resolver });
  const { control, register, handleSubmit, reset, formState, getValues, setValue } = form;
  const [titlesSync, setTitlesSync] = useState<{
    busy: boolean;
    text: string;
    tone: "muted" | "ok" | "warn" | "error";
  }>({ busy: false, text: "", tone: "muted" });

  /** Названия по локалям из словаря Promo Graphic по frontend_identifier — в поля формы. */
  async function pullTitlesFromGraphic() {
    const frontId = String(getValues("frontendIdentifier") ?? "").trim();
    if (!frontId) {
      setTitlesSync({ busy: false, text: "Сначала заполните frontend_identifier", tone: "warn" });
      return;
    }
    setTitlesSync({ busy: true, text: "Ищу в словаре Promo Graphic…", tone: "muted" });
    try {
      const titles = await lookupFrontTitles(frontId);
      if (!titles) {
        setTitlesSync({
          busy: false,
          text: `«${frontId}» нет в словаре «Названия фронт»`,
          tone: "warn",
        });
        return;
      }
      const merged = mergeLocales(getValues("locales"), titles, KNOWN_LOCALE_CODES);
      for (const code of KNOWN_LOCALE_CODES) {
        if (titles[code]) setValue(`locales.${code}`, titles[code], { shouldDirty: true });
      }
      setTitlesSync({
        busy: false,
        text: merged.missing.length
          ? `Подставлено. Не заполнены: ${merged.missing.join(", ")}`
          : "Подставлено — все локали заполнены. Не забудьте сохранить задачу.",
        tone: merged.missing.length ? "warn" : "ok",
      });
    } catch (err) {
      setTitlesSync({
        busy: false,
        text: `${err instanceof Error ? err.message : String(err)} — вход в Promo Graphic в окне расширения`,
        tone: "error",
      });
    }
  }

  // Новая исходная задача → форма перезаполняется (как fillFromTask).
  useEffect(() => {
    reset(sourceTask ? taskToFormValues(sourceTask, { mode }) : emptyFormValues());
  }, [sourceTask, mode, reset]);

  // Черновик из графика: тег и группы бонусов из брифа, когда справочники загрузятся.
  const metaTags = meta.data?.tags;
  const metaBonuses = meta.data?.bonuses;
  useEffect(() => {
    if (!sourceTask) return;
    const fill = (name: "tag" | "mainBonusGroupId" | "secondaryBonusGroupId", value: string) => {
      if (value && !getValues(name)) setValue(name, value, { shouldDirty: true });
    };
    if (metaTags) fill("tag", findTagIdByName(String(sourceTask._plannerTag ?? ""), metaTags));
    if (metaBonuses) {
      fill(
        "mainBonusGroupId",
        findBonusIdByPoints(sourceTask._plannerRewardPoints as number | null, metaBonuses),
      );
      fill(
        "secondaryBonusGroupId",
        findBonusIdByPoints(sourceTask._plannerSecondaryRewardPoints as number | null, metaBonuses),
      );
    }
  }, [sourceTask, metaTags, metaBonuses, getValues, setValue]);

  // Предшественник из графика → gamification_tasks, один раз на черновик (удалённое не вернётся).
  const prereqAppliedFor = useRef<TaskLike | null>(null);
  useEffect(() => {
    const prereqName = String(sourceTask?._plannerPrerequisiteName ?? "");
    if (!prereqName || !taskOptions.length || prereqAppliedFor.current === sourceTask) return;
    prereqAppliedFor.current = sourceTask;
    const next = withPrerequisiteCondition(getValues("conditions"), prereqName, taskOptions);
    if (next) setValue("conditions", next, { shouldDirty: true });
  }, [sourceTask, taskOptions, getValues, setValue]);

  const [openSections, setOpenSectionsState] = useState<Record<SectionId, boolean>>(() => {
    const initial = readOpenSections(sectionsStorageKey) ?? initialOpenSections;
    return Object.fromEntries(SECTION_IDS.map((id) => [id, initial.includes(id)])) as Record<
      SectionId,
      boolean
    >;
  });
  const setOpenSections = (
    update: (prev: Record<SectionId, boolean>) => Record<SectionId, boolean>,
  ) =>
    setOpenSectionsState((prev) => {
      const next = update(prev);
      writeOpenSections(sectionsStorageKey, next);
      return next;
    });
  const [status, setStatus] = useState<{ text: string; error: boolean }>({
    text: "Загрузите исходную задачу",
    error: false,
  });
  const [result, setResult] = useState<string>("Здесь будет результат запросов");
  const [submitting, setSubmitting] = useState(false);

  const type = useWatch({ control, name: "type" });
  const events = useWatch({ control, name: "events" });
  const infinite = useWatch({ control, name: "infinite" });
  const sequence = isSequenceType(type);
  const hasScheduler = eventsIncludeScheduler(events ?? []);
  const hints = useMemo(() => groupPlannerHints(sourceTask), [sourceTask]);
  const metaData = meta.data;
  const metaMode = metaData != null;
  const actionFieldOptions = useMemo(
    () => buildActionFieldOptionsFromConditionsSchema(schema.data),
    [schema.data],
  );
  const showField = (name: string) => !(sequence && SEQUENCE_HIDDEN_FIELDS.has(name));

  function print(value: unknown) {
    setResult(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }

  function buildPayload(values: TaskFormValues) {
    return buildTaskPayload(values, sourceTask, { metaTags: metaData?.tags ?? null });
  }

  const submit = handleSubmit(async (values) => {
    if (submitting) return;
    setSubmitting(true);
    setStatus({ text: labels.submitting, error: false });
    try {
      const payload = buildPayload(values);
      print(payload);
      const response = await onSubmit(payload);
      if (response !== undefined) print(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      print(message);
      setStatus({ text: message.split("\n")[0] ?? message, error: true });
    } finally {
      setSubmitting(false);
    }
  });

  const preview = handleSubmit((values) => {
    try {
      print(buildPayload(values));
      setStatus({ text: labels.preview, error: false });
    } catch (err) {
      setStatus({
        text: `Ошибка в форме: ${err instanceof Error ? err.message : String(err)}`,
        error: true,
      });
    }
  });

  const fieldError = (name: "name" | "frontendIdentifier") => formState.errors[name]?.message;
  const typeOptions = (metaData?.types ?? DEFAULT_TASK_TYPES).map((v) => ({
    value: v,
    label: typeLabel(v),
  }));
  const categoryOptions = (metaData?.categories ?? DEFAULT_CATEGORIES).map((v) => ({
    value: v,
    label: categoryLabel(v),
  }));
  const priorityOptions = (metaData?.priorities ?? DEFAULT_PRIORITIES).map((v) => ({
    value: String(v),
    label: priorityLabel(v),
  }));
  const bonusOptions = (metaData?.bonuses ?? []).map((b) => ({ value: b.id, label: b.title }));
  const ready = sourceTask != null && !meta.loading;

  return (
    <form
      className={cn(
        "flex flex-col gap-3",
        submitting && "pointer-events-none opacity-70",
        className,
      )}
      onSubmit={(e) => e.preventDefault()}
      noValidate
    >
      <h2 className="text-title-2">{title ?? labels.title}</h2>

      <div
        className={cn(
          "rounded-md px-3 py-2 text-caption",
          meta.loading
            ? "bg-surface-2/50 text-muted-foreground"
            : meta.error
              ? "bg-destructive/10 text-destructive"
              : "bg-surface-2/50 text-muted-foreground",
        )}
        role="status"
      >
        {meta.loading
          ? "Загрузка справочников…"
          : meta.error
            ? `Meta не загружена — ручной ввод: ${meta.error}`
            : metaData
              ? `Справочники загружены: ${metaData.filters.length} фильтров, ${metaData.tags.length} тегов${countries.data ? `, ${countries.data.countries.length} стран` : ""}`
              : ""}
      </div>

      <p
        className={cn(
          "px-1 text-subhead",
          status.error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {status.text}
      </p>

      {hints.top ? (
        <aside className="rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="mb-1 text-caption font-semibold text-primary">{hints.top.title}</div>
          <pre className="text-subhead whitespace-pre-wrap">{hints.top.text}</pre>
        </aside>
      ) : null}

      {/* ---------------- Основное ---------------- */}
      <Section
        id="basic"
        open={openSections.basic}
        onOpenChange={(o) => setOpenSections((s) => ({ ...s, basic: o }))}
        hint={hints.sections.basic}
      >
        <Field label={labels.sourceId} htmlFor="tf-source-id">
          <Input id="tf-source-id" readOnly {...register("sourceId")} className="font-mono" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Название (name) *" htmlFor="tf-name" wide hint={fieldError("name")}>
            <Input id="tf-name" {...register("name")} aria-invalid={Boolean(fieldError("name"))} />
          </Field>
          <details className="col-span-2 rounded-md bg-surface-2/40 p-3" open>
            <summary className="cursor-pointer text-subhead select-none">
              Названия по языкам
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KNOWN_LOCALE_CODES.map((code) => (
                <Field key={code} label={code} htmlFor={`tf-locale-${code}`}>
                  <Input
                    id={`tf-locale-${code}`}
                    {...register(`locales.${code}`)}
                    className="h-9"
                  />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={titlesSync.busy}
                onClick={() => void pullTitlesFromGraphic()}
                title="Найти переводы по frontend_identifier в словаре «Названия фронт» Promo Graphic"
              >
                {titlesSync.busy ? <Loader2 className="animate-spin" /> : <Languages />}
                Подтянуть из графика
              </Button>
              {titlesSync.text ? (
                <span
                  role="status"
                  className={cn(
                    "text-caption",
                    titlesSync.tone === "ok" && "text-success",
                    titlesSync.tone === "warn" && "text-primary",
                    titlesSync.tone === "error" && "text-destructive",
                    titlesSync.tone === "muted" && "text-muted-foreground",
                  )}
                >
                  {titlesSync.text}
                </span>
              ) : null}
            </div>
          </details>
          <Field
            label="ID для фронта (frontend_identifier) *"
            htmlFor="tf-fi"
            hint={fieldError("frontendIdentifier")}
          >
            <Input
              id="tf-fi"
              {...register("frontendIdentifier")}
              aria-invalid={Boolean(fieldError("frontendIdentifier"))}
              className="font-mono"
            />
          </Field>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2 pb-2">
            <Controller
              control={control}
              name="hidden"
              render={({ field }) => (
                <CheckboxField
                  label="Скрытое (hidden)"
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              )}
            />
            {sequence ? (
              <Controller
                control={control}
                name="manualReward"
                render={({ field }) => (
                  <CheckboxField
                    label="Ручное получение награды"
                    checked={field.value}
                    onCheckedChange={(c) => field.onChange(c === true)}
                  />
                )}
              />
            ) : null}
          </div>
          <Field label="Тип">
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value}
                  onValueChange={field.onChange}
                  options={typeOptions}
                  aria-label="Тип"
                />
              )}
            />
          </Field>
          <Field label="Согласие игрока">
            <Controller
              control={control}
              name="playerConsentRequired"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value ? "true" : "false"}
                  onValueChange={(v) => field.onChange(v === "true")}
                  options={[
                    { value: "false", label: "Нет" },
                    { value: "true", label: "Да" },
                  ]}
                  aria-label="Согласие игрока"
                />
              )}
            />
          </Field>
          {showField("countries") ? (
            <Field label="Страны" wide>
              <Controller
                control={control}
                name="countries"
                render={({ field }) => (
                  <CountrySelector
                    value={field.value}
                    onChange={field.onChange}
                    data={countries.data}
                    loading={countries.loading}
                  />
                )}
              />
            </Field>
          ) : null}
        </div>
      </Section>

      {/* ---------------- Классификация ---------------- */}
      <Section
        id="classification"
        open={openSections.classification}
        onOpenChange={(o) => setOpenSections((s) => ({ ...s, classification: o }))}
        hint={hints.sections.classification}
      >
        <div className="grid grid-cols-2 gap-3">
          {showField("category") ? (
            <Field label="Кампания">
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    options={categoryOptions}
                    nullable
                    aria-label="Кампания"
                  />
                )}
              />
            </Field>
          ) : null}
          <Field label="Приоритет">
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <SimpleSelect
                  value={field.value}
                  onValueChange={field.onChange}
                  options={priorityOptions}
                  aria-label="Приоритет"
                />
              )}
            />
          </Field>
          <Field label="Тег" wide>
            {metaData ? (
              <Controller
                control={control}
                name="tag"
                render={({ field }) => (
                  <SimpleSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    options={metaData.tags.map((t) => ({ value: String(t.id), label: t.name }))}
                    nullable
                    aria-label="Тег"
                  />
                )}
              />
            ) : (
              <MetaNote text="Справочник тегов не загружен — будет использован тег исходной задачи" />
            )}
          </Field>
        </div>
      </Section>

      {/* ---------------- Начало работы ---------------- */}
      {!SEQUENCE_HIDDEN_SECTIONS.has("startup") || !sequence ? (
        <Section
          id="startup"
          open={openSections.startup}
          onOpenChange={(o) => setOpenSections((s) => ({ ...s, startup: o }))}
          hint={hints.sections.startup}
        >
          <Field label="События запуска">
            {metaData ? (
              <Controller
                control={control}
                name="events"
                render={({ field }) => (
                  <MultiCombobox
                    options={toLabeledOptions(metaData.events, eventLabel)}
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="Выберите события…"
                    searchPlaceholder="Поиск события…"
                    aria-label="События запуска"
                  />
                )}
              />
            ) : (
              <MetaNote text="Справочник не загружен — события запуска недоступны" />
            )}
          </Field>
        </Section>
      ) : null}

      {/* ---------------- Таргетинг ---------------- */}
      {!sequence ? (
        <Section
          id="targeting"
          open={openSections.targeting}
          onOpenChange={(o) => setOpenSections((s) => ({ ...s, targeting: o }))}
          hint={hints.sections.targeting}
        >
          <p className="text-caption text-muted-foreground">
            Условия показа задачи игроку. Добавляйте нужные условия из справочника.
          </p>
          <Controller
            control={control}
            name="conditions"
            render={({ field }) => (
              <ConditionsBuilder
                value={field.value}
                onChange={field.onChange}
                schema={schema.data}
                schemaLoading={schema.loading}
                schemaError={schema.error}
                duplicable={schema.duplicable}
                taskOptions={taskOptions}
                countries={{ data: countries.data, loading: countries.loading }}
              />
            )}
          />
        </Section>
      ) : null}

      {/* ---------------- Доступность по времени ---------------- */}
      <Section
        id="availability"
        open={openSections.availability}
        onOpenChange={(o) => setOpenSections((s) => ({ ...s, availability: o }))}
        hint={hints.sections.availability}
      >
        <div className="grid grid-cols-2 gap-3">
          {showField("schedule") && hasScheduler ? (
            <div className="col-span-2">
              <Controller
                control={control}
                name="schedule"
                render={({ field }) => (
                  <RepeatSchedule value={field.value} onChange={field.onChange} />
                )}
              />
            </div>
          ) : null}
          {showField("availableFrom") ? (
            <Field label="Доступно с" htmlFor="tf-from">
              <Input id="tf-from" type="datetime-local" step={60} {...register("availableFrom")} />
            </Field>
          ) : null}
          {showField("availableTill") ? (
            <Field label="Доступно до" htmlFor="tf-till">
              <Input id="tf-till" type="datetime-local" step={60} {...register("availableTill")} />
            </Field>
          ) : null}
          {showField("maxRepetitions") ? (
            <Field label="Сколько раз может быть получено" htmlFor="tf-max-rep">
              <Input
                id="tf-max-rep"
                type="number"
                min={0}
                step={1}
                placeholder="не ограничено"
                {...register("maxRepetitions")}
              />
            </Field>
          ) : null}
          <Field label="Время жизни (в минутах)" htmlFor="tf-duration">
            <Input
              id="tf-duration"
              type="number"
              min={0}
              step={1}
              placeholder="например 360"
              disabled={infinite}
              {...register("duration")}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Controller
              control={control}
              name="infinite"
              render={({ field }) => (
                <CheckboxField
                  label="бессрочно"
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              )}
            />
          </div>
        </div>
      </Section>

      {/* ---------------- Целевые действия ---------------- */}
      <Section
        id="actions"
        open={openSections.actions}
        onOpenChange={(o) => setOpenSections((s) => ({ ...s, actions: o }))}
        hint={hints.sections.actions}
      >
        <p className="text-caption text-muted-foreground">
          Основной и дополнительный блоки целевых действий, как в админке PromoHub.
        </p>
        <Controller
          control={control}
          name="actions"
          render={({ field }) => (
            <ActionsBuilder
              value={field.value}
              onChange={field.onChange}
              domain={domain}
              fieldOptions={actionFieldOptions}
            />
          )}
        />
      </Section>

      {/* ---------------- Вознаграждение ---------------- */}
      <Section
        id="rewards"
        open={openSections.rewards}
        onOpenChange={(o) => setOpenSections((s) => ({ ...s, rewards: o }))}
        hint={hints.sections.rewards}
      >
        <div className="grid grid-cols-2 gap-3">
          {(["mainBonusGroupId", "secondaryBonusGroupId"] as const).map((name) => (
            <Field
              key={name}
              label={
                name === "mainBonusGroupId"
                  ? "Основная группа бонусов (main_bonus_group_id)"
                  : "Доп. группа бонусов (secondary_bonus_group_id)"
              }
              htmlFor={`tf-${name}`}
            >
              <Controller
                control={control}
                name={name}
                render={({ field }) =>
                  metaMode ? (
                    <SimpleSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={bonusOptions}
                      nullable
                      aria-label={name}
                    />
                  ) : (
                    <Input
                      id={`tf-${name}`}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={name === "mainBonusGroupId" ? "gamification_award:..." : "null"}
                      className="font-mono"
                    />
                  )
                }
              />
            </Field>
          ))}
        </div>
      </Section>

      {/* ---------------- Уведомления ---------------- */}
      <Section
        id="notifications"
        open={openSections.notifications}
        onOpenChange={(o) => setOpenSections((s) => ({ ...s, notifications: o }))}
        hint={hints.sections.notifications}
      >
        <Field label="Уведомления">
          {metaData ? (
            <Controller
              control={control}
              name="notificationEvents"
              render={({ field }) => (
                <MultiCombobox
                  options={toLabeledOptions(metaData.notification_events, notificationEventLabel)}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Выберите уведомления…"
                  aria-label="Уведомления"
                />
              )}
            />
          ) : (
            <MetaNote text="Справочник не загружен — уведомления недоступны" />
          )}
        </Field>
      </Section>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          disabled={!ready || submitting}
          onClick={() => void submit()}
        >
          {submitting ? labels.submitting : labels.submit}
        </Button>
        {showPreview ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            disabled={!ready}
            onClick={() => void preview()}
          >
            Показать payload
          </Button>
        ) : null}
      </div>

      <pre className="max-h-64 overflow-auto rounded-md bg-surface p-3 font-mono text-caption whitespace-pre-wrap text-muted-foreground">
        {result}
      </pre>
    </form>
  );
}
