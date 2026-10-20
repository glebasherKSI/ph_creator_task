import { Calendar, Clock, Plus, Search, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";

const SWATCHES = [
  { name: "background", cls: "bg-background" },
  { name: "surface", cls: "bg-surface" },
  { name: "surface-2", cls: "bg-surface-2" },
  { name: "muted-foreground", cls: "bg-muted-foreground" },
  { name: "foreground", cls: "bg-foreground" },
  { name: "primary / accent", cls: "bg-primary" },
  { name: "destructive", cls: "bg-destructive" },
  { name: "success", cls: "bg-success" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title-2">{title}</h2>
      {children}
    </section>
  );
}

/** Макет карточки задачи на канве — проверка бейджей, выделения и мета-строки. */
function TaskCardMock({ selected, sequence }: { selected?: boolean; sequence?: boolean }) {
  return (
    <div
      className={[
        "w-[260px] rounded-lg bg-surface transition-colors",
        selected ? "border border-primary" : "border border-transparent",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="flex items-center gap-1.5">
          <span className="text-caption font-semibold text-muted-foreground">#1456</span>
          <Badge variant="accent">BE</Badge>
          {sequence ? <Badge variant="neutral">Цепочка</Badge> : null}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Убрать с канвы">
          <X />
        </Button>
      </div>
      <div className="flex flex-col gap-1.5 px-3 pb-3 pt-1">
        <div className="text-headline">Хьюстон, у нас пополнение!</div>
        <div className="text-caption text-muted-foreground">test_chains</div>
        <div className="flex items-center gap-3 pt-1 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3" /> 01.10 — 31.10
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" /> 1440 мин
          </span>
          <span className="ml-auto font-semibold text-primary">5 б.</span>
        </div>
      </div>
    </div>
  );
}

export function Showcase() {
  const [tab, setTab] = useState<"canvas" | "stats" | "packages">("canvas");
  const [type, setType] = useState<"enabled" | "disabled">("enabled");
  const [logic, setLogic] = useState<"and" | "or">("or");
  const [ready, setReady] = useState(false);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-large-title">Дизайн-система</h1>
        <p className="text-body text-muted-foreground">
          Токены и базовые компоненты нового стека. Тёмная тема — основная.
        </p>
      </header>

      <Section title="Типографика">
        <div className="flex flex-col gap-2">
          <div className="text-large-title">Large Title — 28 / 700</div>
          <div className="text-title-1">Title 1 — 22 / 700</div>
          <div className="text-title-2">Title 2 — 18 / 600</div>
          <div className="text-headline">Headline — 15 / 600</div>
          <div className="text-body">Body — 14 / 400</div>
          <div className="text-subhead">Subhead — 13 / 400</div>
          <div className="text-caption">Caption — 11 / 400</div>
        </div>
      </Section>

      <Section title="Цвета">
        <div className="flex flex-wrap gap-3">
          {SWATCHES.map((s) => (
            <div key={s.name} className="flex w-28 flex-col gap-1.5">
              <div className={`h-20 rounded-md border border-border ${s.cls}`} />
              <span className="text-caption text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Кнопки">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Сохранить</Button>
          <Button variant="primary" disabled>
            Сохранить
          </Button>
          <Button variant="secondary">Загрузить задачи</Button>
          <Button variant="outline">Загрузить шаблон</Button>
          <Button variant="ghost">Отмена</Button>
          <Button variant="destructive">Удалить</Button>
          <Button variant="secondary" size="icon" aria-label="Добавить">
            <Plus />
          </Button>
          <Button variant="primary" size="lg">
            Перейти в конструктор
          </Button>
          <Button variant="secondary" size="sm">
            Выбрать все
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!ready}>
            Отправить
          </Button>
          <label className="flex items-center gap-2 text-subhead text-muted-foreground">
            <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />
            форма заполнена (кнопка становится оранжевой)
          </label>
        </div>
      </Section>

      <Section title="Сегменты">
        <div className="flex flex-wrap items-center gap-6">
          <Segmented
            aria-label="Раздел"
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "canvas", label: "Канва" },
              { value: "stats", label: "Статистика" },
              { value: "packages", label: "Пакеты" },
            ]}
          />
          <Segmented
            aria-label="Тип"
            size="sm"
            value={type}
            onValueChange={setType}
            options={[
              { value: "enabled", label: "Включая" },
              { value: "disabled", label: "Исключая" },
            ]}
          />
          <Segmented
            aria-label="Логика списка"
            size="sm"
            value={logic}
            onValueChange={setLogic}
            options={[
              { value: "and", label: "И" },
              { value: "or", label: "Или" },
            ]}
          />
        </div>
      </Section>

      <Section title="Бейджи">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="accent">BE</Badge>
          <Badge variant="accent-outline">Только локально</Badge>
          <Badge variant="neutral">Цепочка</Badge>
          <Badge variant="destructive">⚠ блок</Badge>
          <Badge variant="success">active</Badge>
          <Badge variant="muted">draft</Badge>
        </div>
      </Section>

      <Section title="Форма">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-title-1 text-primary">Movie Quiz +</CardTitle>
            <CardDescription>Параметры задачи</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Название (name) *</Label>
              <Input id="name" placeholder="Название" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fi">ID для фронта (frontend_identifier) *</Label>
              <Input id="fi" placeholder="test_chains" />
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="name, id, frontend_identifier" />
            </div>
            <p className="text-caption text-muted-foreground">
              * Обязательные поля. Остальное можно заполнить позже.
            </p>
            <Button variant="primary" size="lg" className="mt-1">
              отправить
            </Button>
          </CardContent>
        </Card>
      </Section>

      <Section title="Карточка на канве">
        <div className="flex flex-wrap gap-6 rounded-lg bg-background p-6 [background-image:radial-gradient(var(--surface-2)_1px,transparent_1px)] [background-size:20px_20px]">
          <TaskCardMock />
          <TaskCardMock selected />
          <TaskCardMock sequence />
        </div>
      </Section>
    </main>
  );
}
