/**
 * Уроки агента: правила из ревью, которые он получает перед каждым шагом. Выключенный урок
 * остаётся в списке (история), но агенту не уходит.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/auth/errors";
import { cn } from "@/lib/utils";

import {
  type AgentLesson,
  createAgentLesson,
  listAgentLessons,
  updateAgentLesson,
} from "./review-api";

const LESSONS_KEY = ["agent-lessons"];

function LessonRow({ lesson, onChanged }: { lesson: AgentLesson; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(lesson.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(patch: { text?: string; active?: boolean }) {
    setBusy(true);
    setError("");
    try {
      await updateAgentLesson(lesson.id, patch);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md px-3 py-2 ring-1 ring-border",
        !lesson.active && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <Switch
          checked={lesson.active}
          disabled={busy}
          onCheckedChange={(active) => void save({ active })}
          aria-label={lesson.active ? "Выключить урок" : "Включить урок"}
          className="mt-0.5"
        />
        {editing ? (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-14 flex-1 text-subhead"
            aria-label="Текст урока"
            autoFocus
          />
        ) : (
          <p className="min-w-0 flex-1 text-subhead whitespace-pre-wrap">{lesson.text}</p>
        )}
        {!editing ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Изменить урок"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(lesson.text);
              setEditing(false);
            }}
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !text.trim()}
            onClick={() => void save({ text: text.trim() })}
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Сохранить
          </Button>
        </div>
      ) : null}
      <span className="text-caption text-muted-foreground">
        {lesson.author ?? "—"} · {lesson.created_at?.slice(0, 16) ?? ""}
        {lesson.source_event_id != null ? " · из ревью задачи" : " · добавлен вручную"}
      </span>
      {error ? <span className="text-caption text-destructive">{error}</span> : null}
    </li>
  );
}

export function LessonsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const lessons = useQuery({ queryKey: LESSONS_KEY, queryFn: listAgentLessons, retry: false });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: LESSONS_KEY });
  const items = lessons.data ?? [];
  const active = items.filter((l) => l.active).length;

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createAgentLesson(draft.trim(), null);
      setDraft("");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[min(92vw,720px)] max-w-none flex-col gap-3">
        <div className="flex flex-col gap-0.5 pr-8">
          <DialogTitle>Уроки агента</DialogTitle>
          <DialogDescription>
            Включённые уроки ({active}) агент получает перед каждым шагом вместе с последними
            правками из ревью. Пишите правило и причину: «Даты бери из брифа, а не из названия
            пакета — в названии бывает месяц запуска».
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="Новое правило для агента"
            aria-label="Новый урок"
            className="min-h-14 text-subhead"
          />
          <div className="flex items-center justify-between gap-2">
            {error ? <span className="text-caption text-destructive">{error}</span> : <span />}
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => void add()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} Добавить
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lessons.isLoading ? (
            <p className="flex items-center gap-1.5 text-subhead text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Загружаю…
            </p>
          ) : lessons.isError ? (
            <p className="text-subhead text-destructive">{errorMessage(lessons.error)}</p>
          ) : !items.length ? (
            <p className="text-subhead text-muted-foreground">
              Уроков пока нет. Они появляются из ревью — или добавьте правило выше.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} onChanged={refresh} />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
