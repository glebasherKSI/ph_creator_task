/**
 * Боковая панель с формой задачи поверх канвы: копия или правка.
 * Открывается через `useTaskSheet.getState().open(mode, taskId)` (нода, страница).
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  SheetContent,
} from "@/components/ui/dialog";
import { TaskForm } from "@/features/task-form/TaskForm";
import type { TaskFormMode } from "@/features/task-form/task-form";
import { createTask, updateTask } from "@/lib/task-api";
import type { TaskPayloadEnvelope } from "@/lib/types";

import { notifyGraphicBackendCreated } from "./packages-actions";
import { useChainsStore } from "./store";

interface TaskSheetState {
  mode: TaskFormMode;
  taskId: string | null;
  open: (mode: TaskFormMode, taskId: string) => void;
  close: () => void;
}

/** Контроллер панели: кто угодно может открыть форму по id задачи на канве. */
export const useTaskSheet = create<TaskSheetState>((set) => ({
  mode: "edit",
  taskId: null,
  open: (mode, taskId) => set({ mode, taskId }),
  close: () => set({ taskId: null }),
}));

export function TaskSheet() {
  const mode = useTaskSheet((s) => s.mode);
  const taskId = useTaskSheet((s) => s.taskId);
  const close = useTaskSheet((s) => s.close);
  const domain = useChainsStore((s) => s.domain);
  const catalog = useChainsStore((s) => s.catalog);
  const catalogOrder = useChainsStore((s) => s.catalogOrder);
  const taskName = useChainsStore((s) => (taskId ? s.canvas[taskId]?.name : undefined));
  const isDraft = useChainsStore((s) => (taskId ? s.canvas[taskId]?.localOnly === true : false));
  const draftBody = useChainsStore((s) => (taskId ? s.canvas[taskId]?.full : null));
  const draftPlannerId = (draftBody?._plannerTaskId as number | string | null | undefined) ?? null;

  const taskOptions = useMemo(
    () => catalogOrder.map((id) => ({ id, name: catalog[id]?.name ?? "" })),
    [catalog, catalogOrder],
  );

  // ensureFull кэширует полную задачу в store; react-query — только ради состояния загрузки.
  const source = useQuery({
    queryKey: ["chains-full", domain, taskId],
    queryFn: () => useChainsStore.getState().ensureFull(taskId!),
    enabled: taskId != null,
    staleTime: 0,
    gcTime: 0,
  });

  async function submit(payload: TaskPayloadEnvelope): Promise<unknown> {
    if (!taskId) throw new Error("Задача не выбрана");
    const store = useChainsStore.getState();
    if (isDraft) {
      // Локальный черновик (из пакета графика): POST, карточка получает настоящий id,
      // последователи перелинковываются, планировщику уходит mark-backend-created.
      const { response, newId, task } = await createTask(domain, payload);
      if (newId == null || !task) {
        const msg = "Задача создана, но id не найден — нажмите «Загрузить задачи»";
        toast.warning(msg);
        store.setStatus(msg, true);
        return response;
      }
      store.applyCreatedTask(task, taskId);
      void notifyGraphicBackendCreated(draftPlannerId, newId);
      toast.success(`Черновик сохранён на бэк как #${newId}`);
      store.setStatus(`Локальный черновик сохранён на бэк как #${newId}`);
      close();
      const followers = useChainsStore.getState().dirtyTargets;
      if (followers.length) void useChainsStore.getState().saveChanges(followers);
      return response;
    }
    if (mode === "edit") {
      const { response, task } = await updateTask(domain, taskId, payload);
      if (task) store.applyUpdatedTask(task);
      toast.success(`Задача #${taskId} сохранена`);
      store.setStatus(`Задача #${taskId} сохранена`);
      close();
      return response;
    }
    const { response, newId, task } = await createTask(domain, payload);
    if (newId == null || !task) {
      const msg = "Задача создана, но id не найден — нажмите «Загрузить задачи»";
      toast.warning(msg);
      store.setStatus(msg, true);
      return response;
    }
    store.applyCreatedTask(task, null, taskId);
    toast.success(`Копия создана — #${newId}`);
    store.setStatus(`Копия создана, новая задача #${newId}`);
    close();
    return response;
  }

  const title = isDraft
    ? "Создать задачу на бэке"
    : mode === "copy"
      ? `Копия задачи #${taskId ?? ""}`
      : `Правка задачи #${taskId ?? ""}`;
  const sourceTask = isDraft ? draftBody : source.data;

  return (
    <Dialog open={taskId != null} onOpenChange={(open) => !open && close()}>
      <SheetContent className="gap-0" aria-describedby={undefined}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="truncate">{taskName || " "}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Закрыть">
              <X />
            </Button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!isDraft && source.isPending && taskId != null ? (
            <div className="flex items-center gap-2 py-8 text-subhead text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загружаю задачу #{taskId}…
            </div>
          ) : !isDraft && source.error ? (
            <p className="text-subhead text-destructive">
              Не удалось загрузить задачу: {(source.error as Error).message}
            </p>
          ) : sourceTask == null ? (
            <p className="text-subhead text-muted-foreground">Задача недоступна.</p>
          ) : (
            <TaskForm
              key={`${mode}:${taskId ?? "none"}`}
              mode={isDraft ? "copy" : mode}
              domain={domain}
              sourceTask={sourceTask}
              taskOptions={taskOptions}
              onSubmit={submit}
              title={isDraft ? "Параметры новой задачи" : undefined}
              sectionsStorageKey="ph_task_form_open_sections"
            />
          )}
        </div>
      </SheetContent>
    </Dialog>
  );
}
