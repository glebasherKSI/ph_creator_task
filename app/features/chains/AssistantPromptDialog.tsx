/**
 * Редактор инструкций консультанта. Каждое сохранение — новая версия в БД Promo Graphic;
 * консультант читает последнюю на каждый вопрос, поэтому правка действует сразу.
 * Откат — открыть старую версию в редакторе и сохранить её как новую.
 */
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/auth/errors";
import { cn } from "@/lib/utils";

import {
  type AssistantPromptState,
  type AssistantPromptVersion,
  loadAssistantPrompt,
  saveAssistantPrompt,
} from "./assistant";

function versionTitle(version: AssistantPromptVersion): string {
  if (version.id == null) return "Встроенные";
  return [`№${version.id}`, version.created_at, version.author].filter(Boolean).join(" · ");
}

/** Монтируется только на время открытия — каждое открытие начинается с актуальной версии. */
export function AssistantPromptDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (version: AssistantPromptVersion) => void;
}) {
  const [state, setState] = useState<AssistantPromptState | null>(null);
  const [text, setText] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAssistantPrompt()
      .then((next) => {
        setState(next);
        setText(next.current.content);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  const dirty = state != null && text.trim() !== state.current.content.trim();
  const builtIn: AssistantPromptVersion = {
    id: null,
    content: state?.default ?? "",
    comment: "Исходный текст из кода бэка",
    author: null,
    created_at: null,
  };

  async function save() {
    setSaving(true);
    setError("");
    try {
      const next = await saveAssistantPrompt(text, comment);
      setState(next);
      setText(next.current.content);
      setComment("");
      onSaved(next.current);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-5xl" showClose={!saving}>
        <DialogHeader>
          <DialogTitle>Инструкции консультанта</DialogTitle>
          <DialogDescription>
            Действуют со следующего вопроса, в том числе в уже открытом диалоге. Снимок канвы и
            номер версии добавляются к инструкциям автоматически.
          </DialogDescription>
        </DialogHeader>

        {!state && !error ? (
          <p className="flex items-center gap-2 py-8 text-subhead text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Загружаю инструкции…
          </p>
        ) : null}

        {state ? (
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_16rem] gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="assistant-prompt">Текст</Label>
                <span className="text-caption text-muted-foreground">
                  Сейчас действует: {versionTitle(state.current)}
                  {dirty ? " · есть несохранённые правки" : ""}
                </span>
              </div>
              <Textarea
                id="assistant-prompt"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="h-[26rem] resize-none font-mono text-caption"
                spellCheck={false}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assistant-prompt-comment">Что изменено</Label>
                <Input
                  id="assistant-prompt-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={255}
                  placeholder="Например: не называть сумму бонуса без группы бонусов"
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-2">
              <Label>Версии</Label>
              <ul className="flex max-h-[31rem] flex-col gap-1 overflow-y-auto">
                {[...state.versions, builtIn].map((version) => {
                  const active = version.id === state.current.id;
                  return (
                    <li
                      key={version.id ?? "default"}
                      className={cn(
                        "flex flex-col gap-1 rounded-md px-2.5 py-2 ring-1 ring-border",
                        active && "ring-primary",
                      )}
                    >
                      <span className="text-caption font-medium">
                        {versionTitle(version)}
                        {active ? " · действует" : ""}
                      </span>
                      {version.comment ? (
                        <span className="text-caption text-muted-foreground">
                          {version.comment}
                        </span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        disabled={text.trim() === version.content.trim()}
                        onClick={() => setText(version.content)}
                      >
                        В редактор
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-subhead text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || !text.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            Сохранить новую версию
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
