# План миграции на WXT + React + TypeScript

Перевод расширения «PromoHub конструктор задач» с чистого JS на современный стек
с новой дизайн-системой (тёмная тема, оранжевый акцент, SF Pro / Inter).

Принцип: **переезжаем по частям, расширение работает после каждого этапа.**
Старый код в `src/` живёт рядом с новым и удаляется только когда его замена готова.

---

## Стек

| Слой               | Выбор                                                       |
| ------------------ | ----------------------------------------------------------- |
| Сборка расширения  | WXT (Vite, MV3, HMR)                                        |
| Язык               | TypeScript (strict)                                         |
| UI                 | React                                                       |
| Компоненты         | shadcn/ui (Radix + Tailwind CSS v4)                         |
| Канва цепочек      | React Flow (`@xyflow/react`)                                |
| Формы              | React Hook Form + Zod                                       |
| Данные с API       | TanStack Query                                              |
| Состояние канвы    | Zustand                                                     |
| Длинные списки     | TanStack Virtual                                            |
| Тосты              | sonner                                                      |
| Графики статистики | Recharts                                                    |
| Иконки             | lucide-react                                                |
| Тесты              | Vitest (логика), Playwright (смоук расширения) — по желанию |

---

## Дизайн-система

### Токены

| Токен               | Значение  | Назначение                                    |
| ------------------- | --------- | --------------------------------------------- |
| `background`        | `#121212` | фон приложения и канвы                        |
| `surface`           | `#1E1E20` | карточки, панели, поля ввода                  |
| `surface-2`         | `#2C2C2E` | ховер, вложенные блоки, неактивные кнопки     |
| `border`            | `#2C2C2E` | разделители (используются редко)              |
| `muted`             | `#8E8E93` | подписи, плейсхолдеры                         |
| `foreground`        | `#F5F5F7` | основной текст                                |
| `accent`            | `#FF7A1A` | активное состояние, главная кнопка, выделение |
| `accent-foreground` | `#121212` | текст на оранжевом в мелких бейджах           |
| `destructive`       | `#FF453A` | ошибки, удаление                              |
| `success`           | `#32D74B` | успех                                         |

### Типографика

`font-family: -apple-system, "SF Pro Text", Inter, system-ui, sans-serif`.
SF Pro лицензионно только для устройств Apple — на Windows рендерится Inter.

| Стиль       | Размер / вес |
| ----------- | ------------ |
| Large Title | 28 / 700     |
| Title 1     | 22 / 700     |
| Title 2     | 18 / 600     |
| Headline    | 15 / 600     |
| Body        | 14 / 400     |
| Subhead     | 13 / 400     |
| Caption     | 11 / 400     |

### Формы и правила

- Скругления: карточки 14–16px, поля ввода 10px, кнопки/бейджи 6px.
- Поля ввода — тёмная заливка без рамки.
- Рамка только у активного/выбранного элемента, и она оранжевая (1px).
- Сегментные переключатели (вкладки, «Включая/Исключая», «И/Или») — активный сегмент с оранжевой заливкой.
- Главная кнопка серая, пока действие недоступно, и оранжевая, когда доступно.
- Белый текст на оранжевом — только на крупных кнопках; в мелких бейджах — тёмный текст (контраст).
- Основная тема — тёмная. Светлая — позже, на тех же токенах.

### Бейджи на канве

- «BE» — оранжевая заливка.
- «Только локально» — оранжевая рамка.
- «Цепочка» — серая заливка (`surface-2`).
- «⚠ блок» — `destructive`.

---

## Риски, которые нужно закрыть заранее

1. **ID расширения и `chrome.storage`.** Данные (домены, сессии, шаблоны канвы, раскладки)
   привязаны к ID расширения. У распакованного расширения ID зависит от пути, а WXT
   собирает в другую папку → ID сменится и данные «пропадут».
   Решение: зафиксировать ID полем `key` в манифесте (взять публичный ключ текущей установки)
   **или** сделать экспорт/импорт storage перед переездом.
2. **Формат данных в storage не меняем.** Ключи из `STORAGE_KEYS`, `LAYOUT_KEY_PREFIX`
   и структура шаблонов канвы должны читаться новым кодом как есть. Если формат меняется —
   только через явную миграцию с версией.
3. **Скрипты на странице админки** (`src/inject/content.js`, `page-hook.js`) работают в
   isolated/main world без import — переносить как отдельные entrypoints WXT, логику не трогать.
4. **Поведение payload.** `buildCreatePayload` / `buildPatchPayload` и правила для
   `type: "sequence"` должны давать байт-в-байт тот же JSON. Закрываем тестами до переписывания UI.

---

## Этапы

Отмечайте `[x]` по мере выполнения. Каждый этап — отдельная ветка и PR.

### Этап 0. Подготовка

- [x] Зафиксировать текущую версию: тег `v2.18.2-legacy`.
- [x] Решить вопрос ID расширения: подобрать `key` под «путевой» ID нельзя, поэтому — экспорт/импорт storage
      (кнопки в тулбаре конструктора, `src/shared/backup.js`) + фиксированный `key` для нового манифеста.
      Подробности и сам ключ: `docs/EXTENSION_ID.md`.
- [x] Добавить в `.gitignore`: `.output/`, `.wxt/`, `extension-key.pem`.
- [x] Собрать «эталонные» payload'ы из HAR → `tests/fixtures/har/` (create обычной задачи и цепочки,
      полные объекты задач из списка, задачи с `gamification_tasks` с/без `only_completed`).
- [ ] Проверить экспорт/импорт вручную: экспорт из текущей установки → импорт в копию расширения из другой папки.

**Готово, когда:** есть тег, экспорт/импорт проверен на копии расширения.

### Этап 1. Каркас

- [x] Инициализировать WXT (React + TS): новый код в `app/` (`srcDir`), старый `manifest.json` и `src/` не тронуты.
      Авто-импорты WXT выключены (`imports: false`) — `browser` и `define*` импортируются явно.
- [x] Перенести поля манифеста: `permissions`, `host_permissions`, `optional_host_permissions`,
      `web_accessible_resources` (файлы `test_primer` → `public/test_primer`), иконки (`public/icon/{16,48,128}.png`), имя, `key`.
      Версия берётся из `package.json` (`3.0.0-dev.0` → `version: 3.0.0`, `version_name: 3.0.0-dev.0`).
- [x] Подключить Tailwind v4; токены дизайн-системы — CSS-переменные в `app/assets/globals.css`
      (имена совместимы с shadcn/ui, так что компоненты из CLI shadcn лягут на ту же тему).
      Базовые компоненты (`button`, `input`, `badge`, `card`, `label`, `segmented`) написаны вручную в `app/components/ui`.
- [x] Подключить шрифт Inter локально (`@fontsource-variable/inter`, бандлится в сборку).
- [x] Алиас `@/` → `app/` (из сгенерированного `.wxt/tsconfig.json`).
- [x] ESLint (flat config, typescript-eslint, react-hooks) + Prettier; `npm run check` = typecheck + lint + format:check.
- [x] Витрина компонентов — unlisted page `showcase.html` (`app/entrypoints/showcase`), открывается кнопкой из временного popup.
- [x] Открыть витрину в браузере и сверить с референсом дизайна (скриншот headless-Chrome сверен; глазами — по желанию).

**Готово, когда:** `wxt dev` открывает браузер с расширением и витриной в новом стиле.

Как запускать: `npm run dev` (Chrome с расширением из `.output/chrome-mv3`, HMR) или `npm run build` и
загрузить `.output/chrome-mv3` как распакованное расширение. Старое расширение из корня репозитория
ставится отдельно и работает параллельно.

### Этап 2. Перенос логики без UI

Перевести в `.ts` модули, не зависящие от DOM, с типами:

- [x] `constants.js`, `format.js`, `domains.js`, `labels-ru.js` → `app/lib/*.ts`
- [x] `tasks.js` → `app/lib/tasks.ts` (`buildCreatePayload`, `buildPatchPayload`, парсинг ответов,
      `SEQUENCE_FIELD_OVERRIDES`, `normalizeGamificationTasksCondition`)
- [x] `api.js`, `meta.js`, `reports.js`, `games-api.js`, `graphic-api.js`
- [x] `conditions-schema.js` → `app/lib/conditions-schema.ts`
- [x] `actions-schema.js` → `app/lib/actions-schema.ts` (154 теста паритета по всем таблицам и coercion-функциям)
- [x] `graphic-task-map.js` → `app/lib/graphic-task-map.ts`
- [x] `storage.js` → `app/lib/storage.ts`; `auth.js` → `app/lib/auth/{errors,session-store,admin-fetch,status}.ts`
      (`admin-fetch`/`status` — только для background). `messaging.ts` — транспорт RPC с таймаутом.
- [x] Типы домена в `app/lib/types.ts`: `GamificationTask`, `TaskType`, `Condition`, `GamificationTasksCondition`,
      `TaskAction`, `TaskTag`; `CanvasTemplate`/`ChainsLayout` — в `storage.ts`. `TaskLike` намеренно свободный.
- [x] Zod-схема `taskPayloadSchema` (`app/lib/task-schema.ts`): для `sequence` требует пустые `events`,
      `conditions`, `countries`, `category`, `cron`, даты, `max_repetitions`.
- [x] Vitest (`npm test`): паритет нового TS со старым JS на фикстурах из HAR через алиас `legacy/*`,
      `only_completed` отсутствует ⇒ `false`, storage/session roundtrip на fake-browser.
      Известное отличие от админки (не шлём `manual_reward`, `cross_project`, `shared_projects`) закреплено тестом —
      решение на этапе 5.

**Готово, когда:** тесты зелёные, старые страницы при этом продолжают импортировать старые `.js`.

### Этап 3. Background и content-скрипты

- [x] `background.js` → `app/entrypoints/background.ts`: роутер сообщений, `onInstalled`, `tabs.onUpdated`
      (инъекция content-script + перехват magic link). Логика Reports вынесена в `app/lib/reports-fetch.ts`.
- [x] `src/inject/content.js` → `app/entrypoints/admin-bridge.ts` (unlisted-скрипт: в манифест не попадает и не добавляет host_permissions,
      инжектится в `content-scripts/admin.js`). `src/shared/content-script.js` → `app/lib/content-script.ts`.
- [x] `page-hook.js` **не переносится**: это мёртвый код — его никто не инжектит, событие `ph-request-captured`
      никто не слушает, popup список запросов не показывает. Ключи `ph_captured_requests` / `ph_capture_enabled`
      остаются в storage как есть (экспорт/импорт их переносит, но не использует).
- [x] Типизированные сообщения: `app/lib/messaging.ts` — реестр `MessageMap` / `TabMessageMap`, `sendMessage`,
      `sendTabMessage`, `createMessageRouter` (общий для background и content-script).
- [ ] Проверить вручную из новой сборки: `npm run dev` → добавить домен → `PH_AUTH_STATUS` → вход (magic link + OTP)
      → `PH_ADMIN_API_FETCH` списка задач. Пока нет popup/страниц — через DevTools service worker
      (`chrome.runtime.sendMessage({action:"PH_AUTH_STATUS", payload:{domain:"…"}})`).

**Готово, когда:** авторизация по домену и `PH_ADMIN_API_FETCH` работают из новой сборки.

### Этап 4. Popup

- [x] Выбор и добавление доменов, запрос host-permissions, «добавить текущую вкладку» (`app/features/popup/useDomains.ts`).
- [x] Статус авторизации по доменам (`PH_AUTH_STATUS`, реакция на `storage.onChanged`). Сам вход (magic link + OTP)
      как и раньше живёт в конструкторе — это `AuthModal` этапа 5.
- [x] Вход в Promo Graphic (логин/пароль, адрес сервера, авто-раскрытие адреса при ошибке сети).
- [x] Кнопка перехода в конструктор — пока ведёт на витрину (`showcase.html`), на этапе 7 переключить на страницу канвы.
- [x] Карточки popup — чистые компоненты на props; на витрине есть секция «Popup» с моковыми состояниями.
- [x] Три блока авторизации — Бэкенд / Graphic / Отчёты — вкладками со строкой статусов (`StatusTabs`),
      последняя вкладка запоминается. Отчёты: новое сообщение `PH_REPORTS_STATUS` (cookie сессии + открытая вкладка),
      кнопка «Открыть Reports» / «Перейти во вкладку».
- [x] Оптимизация открытия: домены показываются сразу, permissions и статусы входа подгружаются асинхронно
      (спиннер на домене), статусы кэшируются в `storage.session` (`auth-cache.ts`) и показываются мгновенно
      при следующем открытии; статус Graphic читается из storage напрямую, без RPC; таймаут проверки домена 8 с.
- [ ] Проверить вручную: `npm run dev` → popup → добавить домен (диалог permission) → статус; вход в Graphic.
- ~~Список перехваченных запросов~~ — перехват мёртв (см. этап 3), в новый popup не переносится.

**Готово, когда:** popup полностью заменяет `src/sniffer/`, старый popup удалён.

### Этап 5. Общие компоненты формы задачи

- [x] Примитивы shadcn-стиля на Radix (`app/components/ui`): popover, dialog/sheet, select, checkbox, switch,
      textarea, tooltip, collapsible, command (cmdk). Конвенции — `app/components/README.md`.
- [x] `MultiCombobox` (`app/components/multi-combobox.tsx`) на cmdk + Popover: чипы, поиск, «Все», удалённый поиск
      с debounce. Без виртуализации — списки до нескольких сотен позиций, не требуется.
- [x] `CountrySelector` + `country-selector.ts` (загрузка стран, конвертеры условий, 79 тестов паритета).
- [x] `RepeatSchedule` + `repeat-schedule.ts` (`parseCron`/`buildCron`, паритет со старым кодом).
- [x] `ConditionsBuilder` + `conditions-builder.ts`: все виджеты из `HANDLED_WIDGET_TYPES`, пикер условий,
      UI/JSON-режим, `countries_with_lists` через `CountrySelector` (110 тестов). Исправлен баг старого кода:
      период `duration` писался в ключ `"duration.period"` верхнего уровня.
- [x] `ActionsBuilder` + `actions-builder.ts` поверх `app/lib/actions-schema.ts` (25 тестов).
- [x] `TaskForm` + `task-form.ts` + `hooks.ts`: секции-карточки, react-hook-form (резолвер Zod свой —
      `@hookform/resolvers` конфликтует с zod 4), режимы copy/edit, meta/ручной ввод, бриф по секциям,
      превью payload. Roundtrip «задача → форма → payload» совпадает с `buildCreatePayload` на фикстурах.
- [x] Для `sequence` форма скрывает «Начало работы», «Таргетинг», страны, кампанию, расписание, даты, лимит
      повторов и шлёт эти поля пустыми (`SEQUENCE_FIELD_OVERRIDES`).
- [x] `AuthModal` → `app/features/auth/` (`AuthProvider` + `useAuth().ensureAuthenticated`, 43 теста).
      Новое: модалка сама переходит к OTP, когда background принял magic link.
- [x] Форма на витрине (`showcase.html`, секция «Форма задачи») на фикстурах #1454 и #1456; SSR-смоук в тестах.
- [ ] Проверить форму вживую на домене: копия обычной задачи и цепочки, «Показать payload» vs старое расширение.
- [x] `manual_reward`, `cross_project`, `shared_projects` теперь уходят в payload как у админки (дефолты `false` / `false` / `[]`,
      `CREATE_TASK_KEYS` + `applyCreateDefaults`). Тесты паритета со старым кодом сравнивают без этих трёх ключей.
- [x] Анимации раскрытия секций и поповеров: Radix `data-state` + `@keyframes` на height/opacity/transform
      (`globals.css`, `@utility animate-*`), 140–240 мс, отключаются при `prefers-reduced-motion`.

**Готово, когда:** `TaskForm` собирает тот же payload, что старая форма, на эталонных задачах.

### Этап 6. Редактор

- [x] Список задач домена: поиск по name/id/frontend_identifier, фильтр статуса, постраничная загрузка,
      виртуализация (TanStack Virtual). Детали задачи — через TanStack Query (`app/features/editor`).
- [x] Открытие задачи в `TaskForm` в режимах «Копия» / «Правка»; создание (`createTask` с поиском id по
      списку, как раньше) и PATCH (`updateTask`) — `app/lib/task-api.ts`, покрыт тестами на fake-browser.
- [x] Вход в админку перед загрузкой списка через `useAuth().ensureAuthenticated` (раньше редактор входа не делал).
- [x] Статистика: `app/features/stats` — агрегация по дням/задачам (паритет со `stats-charts.js`),
      фильтры периода/проекта, сводные метрики, карточки задач с мини-графиками на Recharts
      (общий курсор внутри карточки через `syncId`).
- [x] Entrypoint `editor.html`; в popup — кнопка «Редактор задач». Тосты — sonner.
- [ ] Проверить вживую: загрузка списка, копия и правка задачи, статистика с открытой вкладкой Reports.
- [ ] `src/editor/` удаляется на этапе 9 вместе со всем старым кодом.

**Готово, когда:** редактор на новом стеке проверен на живом домене.

### Этап 7. Канва цепочек

Самый большой этап — делить на под-PR:

- [x] 7.1 Каркас `chains.html`: шапка (домен, «Загрузить задачи» с входом через `AuthModal`, «Загрузить ещё»,
      «Выровнять», «Вписать», «Сохранить (N)»), статус. Вкладки «Статистика / Пакеты» — этап 8.
- [x] 7.2 Каталог слева: поиск, фильтр статуса, чекбоксы + «Добавить выбранные», бейдж «на канве» и фокус
      на карточку, виртуализация.
- [x] 7.3 React Flow: узел `TaskNode` по макету витрины (id, бейджи BE / Цепочка / Только локально, имя,
      frontend_identifier, Старт/Конец/Время жизни/Награда, чипы зависимостей), цвет шапки (8 пресетов), контекстное меню.
- [x] 7.4 Связи: перетаскивание «Выход → Вход», удаление Delete/Backspace и из панели, выделение;
      синхронизация с `gamification_tasks` (`graph.ts`), панель связи (тип, И/Или, «Только выполненные», список источников
      включая id вне канвы).
- [x] 7.5 Zustand-стор (`store.ts`): canvas, edges, targetConfigs, dirtyTargets; сохранение PATCH по грязным целям с логом.
- [x] 7.6 Зум/пан (React Flow), «Вписать», автораскладка по колонкам (`layout.ts`), позиции в storage
      (прежний формат `ph_chains_layout_<domain>`). Выделение рамкой — штатное в React Flow (Shift + drag).
- [ ] 7.7 Подписи на канве, контекстное меню канвы.
- [~] 7.8 Локальные черновики: в `graph.ts` есть перенос id после POST и перелинковка последователей (`remapTaskId`),
  UI создания черновиков придёт с шаблонами/пакетами.
- [ ] 7.9 Шаблоны канвы: сохранить / перезаписать / загрузить / удалить, копирование задачи и шаблона на другой проект.
- [ ] 7.10 Проверка блоков (конфликты блокировки) и подсветка.
- [x] 7.11 Боковая панель `TaskForm` поверх канвы (`TaskSheet`): копия (новая карточка справа от исходной) и правка.
- [ ] 7.12 Решить поведение связей для `sequence` (запретить входящие связи или не отправлять conditions).
- [ ] Мультивыделение в тулбаре (выбрать все / снять / убрать выбранные), сворачивание каталога в рейку,
      измеренные высоты карточек в автораскладке (сейчас `CARD_MIN_H`).
- [ ] Проверить вживую: загрузка каталога, добавление на канву (позиции из старого storage должны подхватиться),
      связь → панель → «Сохранить» → PATCH; копия и правка из карточки.

**Готово, когда:** все сценарии старой канвы повторены, шаблоны из storage открываются без потерь.

### Этап 8. Статистика и пакеты (Graphic API)

- [x] Вкладка «Статистика» на канве — тот же `StatsPanel`/`useStatsReport`, что в редакторе; «только выбранная»
      берёт выделенную карточку.
- [x] Вкладка «Пакеты»: сессия Graphic (`GraphicCard`), фильтр статуса, список пакетов, «Открыть на канве»
      (`packages.ts` — раскладка по цепочкам графика, `packages-actions.ts` — загрузка задач с `ph_backend_id`,
      локальные черновики для остальных, перенос связей `prerequisite_task_id` включая предшественников из других пакетов).
- [x] Черновик из пакета → `TaskSheet` «Создать задачу на бэке»: POST, карточка получает реальный id
      (`remapTaskId`), последователи PATCH-ятся, планировщику уходит `mark-backend-created`.
- [ ] Проверить вживую: открыть пакет с задачами с бэка и без, создать черновик, убедиться, что связи подвязались
      и `mark-backend-created` ушёл.

**Готово, когда:** обе вкладки проверены на живых данных.

### Этап 9. Уборка и релиз

- [x] Удалить старые `manifest.json`, `background.js`, `src/`, `icons/`, `test_primer/`; `src/shared` переехал в
      `tests/legacy/shared` как эталон для тестов паритета (в сборку не попадает).
- [x] Обновить `README.md` (структура, команды `dev` / `build` / `zip`).
- [x] Поднять версию до `3.0.0`, собрать zip (`npm run zip` → `.output/*.zip`).
- [x] Экспорт/импорт данных перенесён в новый стек (`app/lib/backup.ts`, кнопки в шапках редактора и канвы).
- [ ] Проверить на чистом профиле и на профиле со старыми данными (домены, сессии, шаблоны).

---

## Порядок проверки на каждом этапе

1. `npm run check` (типы + линт) и `npm test`.
2. `wxt dev` — ручной прогон затронутых сценариев.
3. Сравнение payload'ов create/patch с эталонами (для этапов 5–8).
4. Старые страницы, которые ещё не перенесены, продолжают работать.
