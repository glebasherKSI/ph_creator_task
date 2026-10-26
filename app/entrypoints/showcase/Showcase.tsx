import { Calendar, Clock, Coins, Plus, Search, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { DomainsCard } from "@/features/popup/DomainsCard";
import { GraphicCard } from "@/features/popup/GraphicCard";
import { ReportsCard } from "@/features/popup/ReportsCard";
import { StatusTabs } from "@/features/popup/StatusTabs";
import type { DomainsState } from "@/features/popup/useDomains";
import type { GraphicState } from "@/features/popup/useGraphic";
import type { ReportsState } from "@/features/popup/useReports";
import { pushMessage, useAssistantPanel } from "@/features/chains/assistant-store";
import { AssistantMessage } from "@/features/chains/AssistantMessage";
import { useChainsStore } from "@/features/chains/store";
import { TaskForm } from "@/features/task-form/TaskForm";
import type { TaskLike } from "@/lib/types";
import { cn } from "@/lib/utils";

import taskInteractiveFixture from "../../../tests/fixtures/har/task-interactive-1454.json";
import taskSequenceFixture from "../../../tests/fixtures/har/task-sequence-1456.json";

/** Задача с несколькими условиями таргетинга — для проверки виджетов условий. */
const TASK_TARGETING_DEMO: TaskLike = {
  ...(taskInteractiveFixture as TaskLike),
  id: 9001,
  name: "Демо таргетинга",
  frontend_identifier: "targeting_demo",
  conditions: [
    {
      cashout: {
        existence: "any",
        status: "any",
        duration: { period: "lifetime", number: 1, include_current_period: false },
        money_range: { type: "range", list: [100, 5000], exclude_end: false },
      },
    },
    { fraud: false },
    { active_phones: null },
    { average_bet: { type: "min", min: 10 } },
    {
      gamification_tasks: {
        list: ["1366"],
        type: "enabled",
        extra_type: "or",
        only_completed: true,
      },
    },
  ],
  serialized_main_actions: [
    {
      action: "deposit",
      requirements: { payments_count: "2", min_points: "10", payment_systems: ["visa"] },
      conditions: { points_sum: "100" },
    },
    { action: "bet", requirements: { bets_count: "5" }, conditions: {} },
  ],
};

/** Больше порога SimpleSelect — открывается облегчённый выбор с поиском. */
const LONG_OPTIONS = Array.from({ length: 300 }, (_, i) => ({
  value: String(i + 1),
  label: `Тег ${i + 1}`,
}));

const TASK_FIXTURES: Record<string, TaskLike> = {
  interactive: taskInteractiveFixture as TaskLike,
  sequence: taskSequenceFixture as TaskLike,
  targeting: TASK_TARGETING_DEMO,
};

const noop = async () => {};

const CONSULTANT_SAMPLE = `Без входящих связей **2** задачи.

### Без связей
- #1454 — интерактивная, действие \`deposit\`
  - доступна с **2026-11-01**, награда — группа \`gamification_award:FS 50\`
- #1456 — цепочка, связи не сохранены

### Что проверить
1. #1456 ссылается на #900 — этой задачи нет на канве.
2. Сохраните связи перед запуском.`;

// Две карточки «на канве» витрины — чтобы чипы #id в ответе консультанта были кликабельными.
useChainsStore.setState((s) => ({
  canvas: {
    ...s.canvas,
    "1454": {
      id: "1454",
      name: String(taskInteractiveFixture.name ?? ""),
      frontend_identifier: "",
      conditions: [],
      full: null,
      x: 0,
      y: 0,
    },
    "1456": {
      id: "1456",
      name: String(taskSequenceFixture.name ?? ""),
      frontend_identifier: "",
      conditions: [],
      full: null,
      x: 0,
      y: 0,
    },
  },
}));

// Ответ лежит в сторе чата, как в панели: оценка и отзыв меняют его через patchMessage.
pushMessage({ role: "assistant", content: CONSULTANT_SAMPLE, logId: 1, promptVersionId: null });

function ConsultantSample() {
  const messages = useAssistantPanel((s) => s.messages);
  return (
    <div className="flex w-96 flex-col gap-3">
      {messages.map((message) => (
        <AssistantMessage key={message.id} message={message} onFocusNode={() => {}} />
      ))}
    </div>
  );
}

/** Моки состояния popup — карточки чистые, живут на props. */
const POPUP_DOMAINS: DomainsState = {
  domains: ["admin.crimson.lex.prd.maxbit.private", "admin.example.com", "admin.no-perm.io"],
  permissions: {
    "admin.crimson.lex.prd.maxbit.private": true,
    "admin.example.com": true,
    "admin.no-perm.io": false,
  },
  auth: {
    "admin.crimson.lex.prd.maxbit.private": { authenticated: true, email: "g@x.io" },
    "admin.example.com": { pendingOtp: true },
  },
  status: "Домен admin.example.com добавлен, доступ разрешён",
  loading: false,
  checking: { "admin.no-perm.io": true },
  addDomain: async () => true,
  addCurrentTab: noop,
  removeDomain: noop,
  refreshAuth: noop,
};

const POPUP_REPORTS: ReportsState = {
  status: {
    ok: true,
    origin: "https://reports.maxbit.private",
    sessionPresent: true,
    xsrfPresent: true,
    tabOpen: false,
    tabId: null,
  },
  error: "",
  refresh: noop,
  openTab: noop,
};

const POPUP_GRAPHIC_ONLINE: GraphicState = {
  status: {
    ok: true,
    authenticated: true,
    user: { username: "gleb" },
    baseUrl: "http://127.0.0.1:8000",
  },
  busy: false,
  error: "",
  login: async () => true,
  logout: noop,
};

const POPUP_GRAPHIC_OFFLINE: GraphicState = {
  ...POPUP_GRAPHIC_ONLINE,
  status: { ok: true, authenticated: false, user: null, baseUrl: "http://127.0.0.1:8000" },
  error: "Failed to fetch",
};

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

/** Подписанное поле в мета-блоке карточки: подпись сверху, значение снизу. */
function MetaField({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        {label}
      </span>
      <span className="truncate text-subhead tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Макет карточки задачи на канве: шапка → тело → мета-сетка. */
function TaskCardMock({ selected, sequence }: { selected?: boolean; sequence?: boolean }) {
  return (
    <div
      className={cn(
        "w-[280px] overflow-hidden rounded-lg border bg-surface transition-colors",
        selected ? "border-primary" : "border-transparent",
      )}
    >
      {/* Шапка: id + бейджи слева, закрыть справа */}
      <div className="flex items-center justify-between gap-2 bg-black/25 py-1.5 pr-1.5 pl-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-caption text-muted-foreground">#1456</span>
          <Badge variant="accent">BE</Badge>
          {sequence ? <Badge variant="neutral">Цепочка</Badge> : null}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Убрать с канвы">
          <X />
        </Button>
      </div>

      {/* Тело: название и frontend_identifier */}
      <div className="px-3 pt-3 pb-2.5">
        <div className="text-headline leading-tight">Хьюстон, у нас пополнение!</div>
        <div className="mt-1 truncate font-mono text-caption text-muted-foreground">
          test_chains
        </div>
      </div>

      {/* Мета: подписанные поля в сетке 2×2 */}
      <div className="mx-3 border-t border-border" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-3 py-3">
        <MetaField icon={Calendar} label="Старт" value="01.10.2026 15:39" />
        <MetaField icon={Calendar} label="Конец" value="31.10.2026 15:39" />
        <MetaField icon={Clock} label="Время жизни" value="1440 мин" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <Coins className="size-3 shrink-0" />
            Награда
          </span>
          <span>
            <Badge variant="accent" className="px-2 text-subhead">
              5 б.
            </Badge>
          </span>
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
  const [tag, setTag] = useState("");
  // Фикстуру можно выбрать hash'ем (#sequence, #targeting) — удобно для скриншотов.
  const [formFixture, setFormFixture] = useState<"interactive" | "sequence" | "targeting">(() => {
    const hash = location.hash.replace("#", "");
    return hash === "sequence" || hash === "targeting" ? hash : "interactive";
  });

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

      <Section title="Длинный список">
        <div className="w-72">
          <SimpleSelect
            value={tag}
            onValueChange={setTag}
            options={LONG_OPTIONS}
            nullable
            aria-label="Длинный список"
          />
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

      <Section title="Ответ консультанта">
        <p className="text-subhead text-muted-foreground">
          #1454 и #1456 «лежат на канве» витрины — чипы кликабельны; #900 вне канвы. Оценка уходит в
          Graphic — без входа откатится с ошибкой.
        </p>
        <ConsultantSample />
      </Section>

      <Section title="Popup">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex w-[380px] flex-col gap-3 rounded-lg bg-background p-3 ring-1 ring-border">
            <StatusTabs
              value="backend"
              onValueChange={() => {}}
              items={[
                { value: "backend", label: "Бэкенд", tone: "pending" },
                { value: "graphic", label: "Graphic", tone: "ok" },
                { value: "reports", label: "Отчёты", tone: "none" },
              ]}
            />
            <DomainsCard state={POPUP_DOMAINS} />
            <GraphicCard state={POPUP_GRAPHIC_ONLINE} />
            <Button variant="primary" size="lg">
              Перейти в конструктор
            </Button>
          </div>
          <div className="flex w-[380px] flex-col gap-3 rounded-lg bg-background p-3 ring-1 ring-border">
            <GraphicCard state={POPUP_GRAPHIC_OFFLINE} />
            <ReportsCard state={POPUP_REPORTS} />
          </div>
        </div>
      </Section>

      <Section title="Форма задачи">
        <p className="text-subhead text-muted-foreground">
          Без домена: справочники в режиме ручного ввода, схема условий и страны — из фикстур.
          Отправка только показывает payload.
        </p>
        <Segmented
          aria-label="Фикстура"
          size="sm"
          value={formFixture}
          onValueChange={setFormFixture}
          options={[
            { value: "interactive", label: "Обычная задача #1454" },
            { value: "sequence", label: "Цепочка #1456" },
            { value: "targeting", label: "Демо таргетинга" },
          ]}
        />
        <div className="max-w-3xl rounded-lg bg-background p-4 ring-1 ring-border">
          <TaskForm
            key={formFixture}
            mode="copy"
            domain=""
            sourceTask={TASK_FIXTURES[formFixture] ?? null}
            initialOpenSections={formFixture === "targeting" ? ["targeting", "actions"] : ["basic"]}
            onSubmit={async (payload) => ({ echo: payload.gamification_task.name })}
          />
        </div>
      </Section>
    </main>
  );
}
