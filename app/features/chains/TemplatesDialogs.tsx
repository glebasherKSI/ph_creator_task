/**
 * Диалоги шаблонов канвы: «Сохранить шаблон» (новый / перезаписать), «Загрузить шаблон»
 * (список, загрузка, удаление, копирование на проект) и «Скопировать на другой проект»
 * (задача или шаблон → локальный черновик на целевом домене).
 * Открываются контроллерами `useSaveTemplateDialog` / `useLoadTemplateDialog` / `useCopyToProjectDialog`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReactFlow } from "@xyflow/react";
import { ArrowLeftRight, FolderOutput, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { useAuth } from "@/features/auth/AuthModal";
import {
  type CanvasTemplate,
  deleteDomainCanvasTemplate,
  getDomainCanvasTemplates,
} from "@/lib/storage";

import { useChainsStore } from "./store";
import {
  buildLoadTemplateConfirmMessage,
  countTemplateLocalDrafts,
  templateMetaLine,
  templateOptionLabel,
  templateViewportFromFlow,
} from "./templates";
import {
  applyCanvasTemplate,
  applyTemplateDraftMatchesAndSave,
  computeTemplateDraftMatches,
  copyTaskToProject,
  copyTemplateToProject,
  saveCanvasTemplate,
} from "./templates-actions";

// ---------------------------------------------------------------------------
// Контроллеры
// ---------------------------------------------------------------------------

interface SimpleDialogState {
  open: boolean;
  /** Растёт при каждом открытии — ключ для сброса локального состояния формы. */
  seq: number;
  show: () => void;
  close: () => void;
}

function simpleDialog() {
  return create<SimpleDialogState>((set) => ({
    open: false,
    seq: 0,
    show: () => set((s) => ({ open: true, seq: s.seq + 1 })),
    close: () => set({ open: false }),
  }));
}

export const useSaveTemplateDialog = simpleDialog();
export const useLoadTemplateDialog = simpleDialog();

export type CopyMode = "task" | "template";

interface CopyDialogState {
  open: boolean;
  seq: number;
  mode: CopyMode;
  taskId: string | null;
  templateId: string | null;
  show: (opts: { mode: CopyMode; taskId?: string | null; templateId?: string | null }) => void;
  close: () => void;
}

export const useCopyToProjectDialog = create<CopyDialogState>((set) => ({
  open: false,
  seq: 0,
  mode: "task",
  taskId: null,
  templateId: null,
  show: ({ mode, taskId, templateId }) =>
    set((s) => ({
      open: true,
      seq: s.seq + 1,
      mode,
      taskId: taskId === undefined ? s.taskId : taskId,
      templateId: templateId ?? null,
    })),
  close: () => set({ open: false }),
}));

const TEMPLATES_KEY = "canvas-templates";

function useDomainTemplates(domain: string, enabled: boolean) {
  return useQuery({
    queryKey: [TEMPLATES_KEY, domain],
    queryFn: () => getDomainCanvasTemplates(domain),
    enabled: enabled && !!domain,
    staleTime: 0,
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Сохранить шаблон
// ---------------------------------------------------------------------------

type SaveMode = "new" | "overwrite";

function SaveTemplateForm({
  templates,
  onDone,
}: {
  templates: CanvasTemplate[];
  onDone: () => void;
}) {
  const rf = useReactFlow();
  const dirtyCount = useChainsStore((s) => s.dirtyTargets.length);
  const [mode, setMode] = useState<SaveMode>("new");
  const [name, setName] = useState("");
  const [existingId, setExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  const canOverwrite = templates.length > 0;
  const effectiveMode: SaveMode = canOverwrite ? mode : "new";

  async function submit() {
    if (effectiveMode === "overwrite" && !existingId) {
      toast.warning("Выберите шаблон для перезаписи");
      return;
    }
    if (effectiveMode === "new" && !name.trim()) {
      toast.warning("Введите название шаблона");
      return;
    }
    setBusy(true);
    try {
      const result = await saveCanvasTemplate(
        effectiveMode === "overwrite"
          ? { mode: "overwrite", templateId: existingId }
          : { mode: "new", name },
        templateViewportFromFlow(rf.getViewport()),
      );
      if (result.warning) toast.warning(result.message);
      else toast.success(result.message);
      onDone();
    } catch (err) {
      toast.warning(errorText(err) || "Не удалось сохранить шаблон");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {canOverwrite ? (
        <div className="flex flex-col gap-1.5">
          <Label>Режим сохранения</Label>
          <Segmented<SaveMode>
            size="sm"
            value={effectiveMode}
            onValueChange={setMode}
            options={[
              { value: "new", label: "Новый шаблон" },
              { value: "overwrite", label: "Перезаписать существующий" },
            ]}
            aria-label="Режим сохранения"
          />
        </div>
      ) : null}

      {effectiveMode === "new" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-save-name">Название шаблона</Label>
          <Input
            id="template-save-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Сезон 3"
            maxLength={80}
            autoComplete="off"
            autoFocus
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>Выберите шаблон</Label>
          <SimpleSelect
            value={existingId}
            onValueChange={setExistingId}
            options={templates.map((t) => ({ value: t.id, label: templateOptionLabel(t) }))}
            placeholder="— Выберите шаблон —"
            aria-label="Шаблон для перезаписи"
          />
        </div>
      )}

      {dirtyCount ? (
        <p className="text-caption text-muted-foreground">
          В шаблон попадут раскладка и связи. Несохранённые изменения данных задач (условия,
          действия) нужно сохранить отдельно кнопкой «Сохранить».
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {effectiveMode === "overwrite" ? "Обновить" : "Сохранить"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SaveTemplateDialog() {
  const open = useSaveTemplateDialog((s) => s.open);
  const seq = useSaveTemplateDialog((s) => s.seq);
  const close = useSaveTemplateDialog((s) => s.close);
  const domain = useChainsStore((s) => s.domain);
  const queryClient = useQueryClient();
  const templates = useDomainTemplates(domain, open);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сохранить шаблон</DialogTitle>
          <DialogDescription>{domain ? `Домен: ${domain}` : "Домен не выбран"}</DialogDescription>
        </DialogHeader>
        {templates.isLoading ? (
          <p className="flex items-center gap-2 text-subhead text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загружаю список шаблонов…
          </p>
        ) : (
          <SaveTemplateForm
            key={seq}
            templates={templates.data ?? []}
            onDone={() => {
              close();
              void queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Загрузить шаблон
// ---------------------------------------------------------------------------

export function LoadTemplateDialog() {
  const open = useLoadTemplateDialog((s) => s.open);
  const close = useLoadTemplateDialog((s) => s.close);
  const domain = useChainsStore((s) => s.domain);
  const auth = useAuth();
  const rf = useReactFlow();
  const queryClient = useQueryClient();
  const templates = useDomainTemplates(domain, open);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(template: CanvasTemplate) {
    const store = useChainsStore.getState();
    const ok = window.confirm(
      buildLoadTemplateConfirmMessage(template, {
        dirtyCount: store.dirtyTargets.length,
        canvasCount: Object.keys(store.canvas).length,
      }),
    );
    if (!ok) return;
    setBusyId(template.id);
    try {
      const result = await applyCanvasTemplate(template, {
        ensureAuthenticated: (d) =>
          auth.ensureAuthenticated(d, { message: `Для загрузки шаблона нужен вход в ${d}` }),
      });
      close();
      if (result.viewport) void rf.setViewport(result.viewport);
      else window.setTimeout(() => void rf.fitView({ padding: 0.2, maxZoom: 1 }), 50);
      if (result.warning) toast.warning(result.message, { duration: 7000 });
      else toast.success(result.message, { duration: result.draftCount ? 8000 : 4000 });
    } catch (err) {
      const message = `Ошибка загрузки шаблона: ${errorText(err)}`;
      useChainsStore.getState().setStatus(message, true);
      toast.warning(message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(template: CanvasTemplate) {
    if (!window.confirm(`Удалить шаблон «${template.name}»?`)) return;
    await deleteDomainCanvasTemplate(domain, template.id);
    await queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
    toast.success(`Шаблон «${template.name}» удалён`);
  }

  function copyToProject(template: CanvasTemplate) {
    close();
    useCopyToProjectDialog.getState().show({ mode: "template", templateId: template.id });
  }

  /**
   * Сопоставляет локальные черновики шаблона (например, после копирования с другого проекта)
   * с уже созданными на бэке задачами по имени — с учётом маркера «Season N»: если имя
   * заканчивается на «… Season N», берётся задача с тем же базовым именем и максимальным
   * номером сезона в каталоге, а не обязательно тем же N, что в черновике.
   */
  async function matchDrafts(template: CanvasTemplate) {
    setBusyId(template.id);
    try {
      const { matched, ambiguous, unmatched } = await computeTemplateDraftMatches(template.id);

      if (!matched.length) {
        const reasonParts: string[] = [];
        if (ambiguous.length)
          reasonParts.push(`${ambiguous.length} — несколько задач с таким именем`);
        if (unmatched.length) reasonParts.push(`${unmatched.length} — совпадений не найдено`);
        toast.warning(
          reasonParts.length
            ? `Не удалось сопоставить черновики: ${reasonParts.join(", ")}`
            : "В шаблоне нет черновиков для сопоставления",
          { duration: 6000 },
        );
        return;
      }

      const lines = matched.map(
        (m) =>
          `«${m.name}» → #${m.newId}${m.season != null ? ` (последний сезон: ${m.season})` : ""}`,
      );
      const confirmParts = [
        `Заменить ${matched.length} черновик${matched.length === 1 ? "" : "ов"} в шаблоне «${template.name}» на созданные задачи?`,
        lines.slice(0, 10).join("\n") + (lines.length > 10 ? `\n…и ещё ${lines.length - 10}` : ""),
      ];
      if (ambiguous.length) confirmParts.push(`Пропущено (неоднозначно): ${ambiguous.length}`);
      if (unmatched.length) confirmParts.push(`Пропущено (нет совпадений): ${unmatched.length}`);
      if (!window.confirm(confirmParts.join("\n\n"))) return;

      await applyTemplateDraftMatchesAndSave(template, matched);
      await queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
      toast.success(
        `Шаблон «${template.name}»: заменено ${matched.length} черновик${matched.length === 1 ? "" : "ов"} на созданные задачи`,
      );
    } catch (err) {
      toast.warning(errorText(err) || "Не удалось обновить шаблон");
    } finally {
      setBusyId(null);
    }
  }

  const list = templates.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Загрузить шаблон</DialogTitle>
          <DialogDescription>
            {domain ? `Домен: ${domain}` : "Сначала выберите домен"}
          </DialogDescription>
        </DialogHeader>
        {templates.isLoading ? (
          <p className="flex items-center gap-2 text-subhead text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загружаю список шаблонов…
          </p>
        ) : !list.length ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-subhead text-muted-foreground">
            Нет сохранённых шаблонов для этого домена
          </p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" aria-label="Шаблоны">
            {list.map((template) => (
              <li
                key={template.id}
                className="flex items-center gap-2 rounded-lg bg-surface-2 p-3 ring-1 ring-border"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-headline">{template.name}</div>
                  <div className="truncate text-caption text-muted-foreground">
                    {templateMetaLine(template)}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busyId != null}
                  onClick={() => void load(template)}
                >
                  {busyId === template.id ? <Loader2 className="animate-spin" /> : null}
                  Загрузить
                </Button>
                {countTemplateLocalDrafts(template) > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Заменить черновики шаблона ${template.name} на созданные задачи`}
                    title="Заменить черновики на созданные задачи с таким же названием"
                    disabled={busyId != null}
                    onClick={() => void matchDrafts(template)}
                  >
                    {busyId === template.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ArrowLeftRight />
                    )}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Копировать шаблон ${template.name} в проект`}
                  title="Копировать шаблон в проект…"
                  disabled={busyId != null}
                  onClick={() => copyToProject(template)}
                >
                  <FolderOutput />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Удалить шаблон ${template.name}`}
                  title="Удалить шаблон"
                  disabled={busyId != null}
                  className="text-destructive hover:text-destructive"
                  onClick={() => void remove(template)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Скопировать на другой проект
// ---------------------------------------------------------------------------

const COPY_HINT: Record<CopyMode, string> = {
  task: "На целевой проект сохранится локальный шаблон-черновик с полными данными задачи (без создания на бэке). Откройте целевой проект → «Загрузить шаблон», поправьте несовместимые поля и сохраните задачу на бэк. Нужна авторизация на целевом проекте.",
  template:
    "На целевой проект сохранится локальный шаблон-черновик со всеми задачами выбранного шаблона, связями и раскладкой (без создания на бэке). Откройте целевой проект → «Загрузить шаблон», поправьте несовместимые поля и сохраните задачи на бэк. Нужна авторизация на целевом проекте.",
};

function CopyToProjectForm({
  others,
  templates,
  onClose,
}: {
  others: string[];
  templates: CanvasTemplate[];
  onClose: () => void;
}) {
  const auth = useAuth();
  const initialMode = useCopyToProjectDialog((s) => s.mode);
  const taskId = useCopyToProjectDialog((s) => s.taskId);
  const initialTemplateId = useCopyToProjectDialog((s) => s.templateId);
  const sourceName = useChainsStore((s) =>
    taskId ? (s.canvas[taskId]?.name ?? s.catalog[taskId]?.name ?? "") : "",
  );
  const [mode, setMode] = useState<CopyMode>(initialMode);
  const [templateId, setTemplateId] = useState(
    initialTemplateId && templates.some((t) => t.id === initialTemplateId) ? initialTemplateId : "",
  );
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mode === "task" && !taskId) {
      toast.warning("Сначала выберите задачу на канве");
      return;
    }
    if (mode === "template" && !templateId) {
      toast.warning("Выберите шаблон для копирования");
      return;
    }
    if (!target) {
      toast.warning("Выберите целевой проект");
      return;
    }
    if (target === useChainsStore.getState().domain) {
      toast.warning("Выберите другой проект, не текущий");
      return;
    }
    setBusy(true);
    try {
      const authed = await auth.ensureAuthenticated(target, {
        message:
          mode === "template"
            ? `Для копирования шаблона на ${target} нужна авторизация на этом проекте`
            : `Для копирования задачи на ${target} нужна авторизация на этом проекте`,
      });
      if (!authed) {
        toast.warning(`Копирование отменено: нет авторизации на ${target}`);
        return;
      }
      onClose();
      if (mode === "template") {
        const result = await copyTemplateToProject(templateId, target);
        if (result.warning) toast.warning(result.message, { duration: 11000 });
        else toast.success(result.message, { duration: 9000 });
      } else {
        const result = await copyTaskToProject(taskId!, target);
        toast.success(result.message, { duration: 9000 });
      }
    } catch (err) {
      toast.warning(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label>Что копировать</Label>
        <Segmented<CopyMode>
          size="sm"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "task", label: "Текущая карточка" },
            { value: "template", label: "Сохранённый шаблон" },
          ]}
          aria-label="Режим копирования"
        />
      </div>

      {mode === "task" ? (
        <p className="text-subhead text-foreground">
          {taskId
            ? `Задача #${taskId}${sourceName ? `: ${sourceName}` : ""}`
            : "Для режима «Текущая карточка» откройте меню задачи на канве → «Копировать в проект…»"}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>Шаблон</Label>
          <SimpleSelect
            value={templateId}
            onValueChange={setTemplateId}
            options={templates.map((t) => ({ value: t.id, label: templateOptionLabel(t) }))}
            placeholder={templates.length ? "— Выберите шаблон —" : "— Нет шаблонов —"}
            disabled={!templates.length}
            aria-label="Шаблон для копирования"
          />
          {!templates.length ? (
            <p className="text-caption text-muted-foreground">
              Нет сохранённых шаблонов на текущем домене. Сначала сохраните шаблон канвы.
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Целевой проект (домен)</Label>
        <SimpleSelect
          value={target}
          onValueChange={setTarget}
          options={others.map((d) => ({ value: d, label: d }))}
          placeholder="— Выберите домен —"
          disabled={!others.length}
          className="font-mono"
          aria-label="Целевой проект"
        />
        {!others.length ? (
          <p className="text-caption text-destructive">
            Нет других проектов в списке доменов — добавьте админку в popup
          </p>
        ) : null}
      </div>

      <p className="text-caption text-muted-foreground">{COPY_HINT[mode]}</p>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !others.length}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Сохранить черновик
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CopyToProjectDialog({ domains }: { domains: string[] }) {
  const open = useCopyToProjectDialog((s) => s.open);
  const seq = useCopyToProjectDialog((s) => s.seq);
  const close = useCopyToProjectDialog((s) => s.close);
  const domain = useChainsStore((s) => s.domain);
  const templates = useDomainTemplates(domain, open);
  const others = domains.filter((d) => d && d !== domain);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Скопировать на другой проект</DialogTitle>
          <DialogDescription>
            {domain ? `Источник: ${domain}` : "Домен не выбран"}
          </DialogDescription>
        </DialogHeader>
        {templates.isLoading ? (
          <p className="flex items-center gap-2 text-subhead text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загружаю список шаблонов…
          </p>
        ) : (
          <CopyToProjectForm
            key={seq}
            others={others}
            templates={templates.data ?? []}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Все три диалога разом — монтируется на странице канвы внутри ReactFlowProvider. */
export function TemplatesDialogs({ domains }: { domains: string[] }) {
  return (
    <>
      <SaveTemplateDialog />
      <LoadTemplateDialog />
      <CopyToProjectDialog domains={domains} />
    </>
  );
}
