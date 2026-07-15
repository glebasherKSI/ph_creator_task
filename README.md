# PromoHub Request Sniffer (Chrome MV3)

Расширение для перехвата API-запросов gamification tasks в PromoHub admin, копирования задач и конструктора связей между ними.

**Версия:** 2.11.1

## Структура проекта

```
PH_CREATOR_TASK/
├── manifest.json              # MV3 манифест
├── background.js              # Service worker (ES module)
├── src/
│   ├── shared/                # Общий код для всех страниц расширения
│   │   ├── constants.js       # Ключи storage, CREATE_TASK_KEYS, лимиты
│   │   ├── domains.js         # Домены админок, permissions, normalizeDomain
│   │   ├── api.js             # apiFetch, resolveAdminTab, formatApiError
│   │   ├── meta.js            # loadTaskMeta, кэш tasks/meta (Phase 1)
│   │   ├── conditions-schema.js  # loadConditionsSchema, definitions (Phase 2)
│   │   ├── conditions-builder.js # UI виджетов conditions (Phase 2)
│   │   ├── conditions-builder.css
│   │   ├── actions-schema.js     # Schema action types + requirements (Phase 3)
│   │   ├── actions-builder.js    # UI конструктор целевых действий (Phase 3)
│   │   ├── actions-builder.css
│   │   ├── content-script.js  # Инъекция content.js / page-hook
│   │   ├── tasks.js           # Парсинг API, buildCreatePayload, buildPatchPayload
│   │   ├── storage.js         # Captures, layout chains в chrome.storage
│   │   ├── format.js          # escapeHtml, formatJson, formatTime
│   │   ├── copy-panel.js      # Общая форма копирования задачи
│   │   └── copy-panel.css     # Стили формы и slide-over панели
│   ├── inject/                # Скрипты на странице админки (IIFE, без import)
│   │   ├── content.js         # Isolated world: storage, PH_API_FETCH, инъекция hook
│   │   └── page-hook.js       # Main world: перехват fetch/XHR
│   ├── sniffer/               # Popup — список перехваченных запросов
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── editor/                # Создатель копий задач
│   │   ├── editor.html
│   │   ├── editor.js
│   │   └── editor.css
│   └── chains/                # Конструктор связей (канва + gamification_tasks)
│       ├── chains.html
│       ├── chains.js
│       └── chains.css
├── test_primer/               # Фикстуры (conditions, meta, constant)
└── exports/                   # Экспорты captures JSON
```

## Зависимости модулей

```
background.js ──► shared/constants, shared/domains

popup.js ──► shared/constants, domains, content-script, format, storage

editor.js ──► shared/constants, domains, api, meta, copy-panel, tasks
              └── conditions-schema, conditions-builder, actions-schema, actions-builder (через copy-panel)

chains.js ──► shared/constants, domains, api, meta, format, storage, tasks, copy-panel

inject/content.js ──► inject/page-hook.js (web_accessible_resource)
```

## Перезагрузка и проверка

1. Откройте `chrome://extensions/`
2. Включите **Режим разработчика**
3. Нажмите **Обновить** на карточке PromoHub (или «Загрузить распакованное» → папка проекта)
4. Проверьте:
   - **Popup** — иконка расширения, домены, перехват
   - **Создатель** — кнопка «Открыть создатель» в popup
   - **Конструктор связей** — кнопка в popup или в editor
5. На вкладке админки PromoHub (https) — создайте/откройте задачу; запрос должен появиться в popup

Если content script не подключается — перезагрузите вкладку админки (F5) и выдайте permission домену в popup.

## Копирование задачи (2.11.0)

### Phase 3: Action builder

Секция **Целевые действия** в `copy-panel.js` использует `mountActionsBuilder` вместо JSON textarea.

- **Схема:** статическая из `exports/panel_schema_extracted.json` → `actionBuilder` (16 action types, `requirementFieldsByAction`).
- **UI:** два блока — **Основной** и **Дополнительный**; в каждом checkbox «Выполнять по порядку» + список action-карточек.
- **Карточка:** select типа действия, динамические поля requirements, conditions (JSON textarea, MVP).
- **Payload:** `serialized_main_actions`, `serialized_secondary_actions`, `main_actions_sequential`, `secondary_actions_sequential`.
- **Режим JSON:** toggle для всей секции (power user).

Action types с полным UI requirements (MVP):

| action | Поля UI |
|--------|---------|
| `bet` | bets_count, bet_points_sum, duration, money_range, game_categories, bet_type (+ min_bet_amount из money_range) |
| `deposit` | payments_count, payment_systems, duration, money_range, points_sum, min/max_points, child_systems |
| `cashout` | как deposit |
| `sport_bet` | sport_bets_count, sport_bet_points_sum, min_bet_amount, odd, result, sport_bet_types, sport_types |

Остальные 12 типов (`email_confirmation`, `scheduler` как event не action, `achievement`, …) → **JSON textarea** для `requirements` внутри карточки. Неизвестные extra-ключи в handled actions → доп. JSON-блок в карточке.

Модули: `src/shared/actions-schema.js`, `actions-builder.js`, `actions-builder.css`.

### Phase 2: Condition widgets builder

Секция **Таргетинг** в `copy-panel.js` использует `mountConditionsBuilder` вместо JSON textarea.

- **Схема:** `GET /admin/api/filters/conditions?locale=ru` (кэш TTL 10 мин, как meta). При ошибке — fallback на `test_primer/conditions.json`.
- **UI:** список активных условий слева, карточки с виджетами справа, picker «Добавить условие» с поиском.
- **Payload:** массив `[{ "condition_name": { …props } }]` — как в админке и captures.
- **Режим JSON:** toggle «Режим JSON» для всей секции (power user).

Реализованные widget types (MVP):

| type | Примеры conditions |
|------|-------------------|
| `boolean_checkboxes` | access_limit, self_exclusion |
| `tags_extended` | user_id, account_id |
| `select` | active_phones, gender |
| `gamification_task` | gamification_tasks |
| `groups` | groups |
| `payment` | deposit, cashout |
| `bet` | bets_count, bets_sum |
| `boolean`, `boolean_tags`, `string`, `number` | fraud, address, chargeable_comp_points |

Остальные ~40 типов → JSON textarea **внутри карточки** этого условия.

Модули: `src/shared/conditions-schema.js`, `conditions-builder.js`, `conditions-builder.css`.

### Phase 1: Meta-driven selects (2.9.0)

При открытии формы копирования (`mountCopyPanel`) загружается `GET /admin/api/gamification/tasks/meta?locale=ru` для выбранного домена (кэш в памяти, TTL 10 мин). Пока meta грузится — поля справочников disabled, spinner в шапке формы. При ошибке — fallback на text/JSON как в 2.8.0.

Поля со `<select>` при успешной загрузке meta:

| Поле | Источник meta |
|------|----------------|
| `type` | types (fallback: interactive, informational, achievement) |
| `filter_id` | filters |
| `category` | categories (fallback из schema) |
| `priority` | priorities (0–4) |
| `tag` / `tag_id` | tags (в payload — объект tag + tag_id) |
| `events` | events (multi-select) |
| `main_bonus_group_id`, `secondary_bonus_group_id` | bonuses |
| `notification_events` | notification_events (multi-select) |

**Страны (2.11.1):** модуль `country-selector.js` — `GET /admin/api/constants?locale=ru` (`countries.all`, `countries_lists`), fallback `test_primer/constant.json`. Toggle `countries_matching_type`: `countries` | `countries_lists`. Multi-select стран с поиском и опцией «Все страны» → `["all"]`; при `countries_lists` — multi-select уровней.

Модуль: `src/shared/meta.js`. Смена домена в editor/chains перезагружает meta через `copyPanel.loadMeta()`.

### Секции формы (2.8.0+)

Форма копирования (`copy-panel.js`) оформлена секциями как в админке PromoHub:

- **Основное** — name, frontend_identifier, hidden, type, filter_id, countries (country-selector), player_consent_required
- **Классификация** — category, tag, priority
- **Начало работы** — events
- **Таргетинг** — conditions (виджеты + JSON fallback), condition_groups (справочно)
- **Доступность по времени** — repeatable, cron, available_from/till, max_repetitions, duration, infinite
- **Целевые действия** — actions-builder (Phase 3): main/secondary blocks, sequential flags
- **Вознаграждение** — main/secondary_bonus_group_id
- **Уведомления** — notification_events
- **Прочие поля** — locales и остальные ключи из `CREATE_TASK_KEYS`

На канве: **ПКМ на карточке** → «Скопировать задачу» → панель справа (~60vw) → **Создать**. Отдельный **Создатель задач** (`editor.html`) — из popup.

## Panel backend analysis

**Статус `exports/panel_backend.js`:** сохранён main entry chunk (~4.4 MB, ~129k строк). Это **Vite + Vue 3**, не Webpack/React. `__webpack_require__` отсутствует; lazy chunks подключаются через `import()` и `__vite__mapDeps`.

**Стек bundle:**

| Слой | Технология |
|------|------------|
| Bundler | Vite (`__vite__mapDeps`, dynamic `import("./form-….js")`) |
| UI | Vue 3 SFC + Ant Design Vue (`AConfigProvider`, `ALayout`, `AInput`, `ACollapsePanel`) |
| State / routing | Pinia (`auth`, `constants`, `settings`) + Vue Router |
| HTTP | Axios `baseURL: "/admin/api"` — request → snake_case, response → camelCase |
| i18n | vue-i18n, ключи `gamification_tasks.*`, `filters.inputs.*` |

**Маршруты gamification tasks** (строки ~113042–113055):

- `/gamification_tasks` → `index-th1QOVAJ.js`
- `/gamification_tasks/new`, `/:id/edit` → **`form-Bg1PQAgX.js`** (lazy chunk **не** в `panel_backend.js`)

**Связанные lazy chunks** (из `__vite__mapDeps`): `conditions-builder-DYRGOO_w.js`, `actions-Bj31hl3s.js`, `form-field-BGF7NXAr.js`, `cron-input`, `form-country-selector`, `form-date-time-picker`.

**Как строится форма (механизм):**

- **Не JSON Schema** — component-driven: секции Vue + обёртка `FormField` + специализированные билдеры.
- **Секции** (i18n `gamification_tasks.form.sections`): `main`, `classification`, `start`, `time_availability`, `target_actions`, `reward`, `notifications`. Отдельного ключа «Таргетинг» в i18n нет — `conditions` рендерятся через `conditions-builder` (паттерн как у `allowed_overdraft_segments.form.sections.conditions`).
- **Справочники** — `GET /admin/api/gamification/tasks/meta?locale=ru` (`events`, `filters`, `bonuses`, `tags`, `notification_events`, `dsl_tags`) — совпадает с `test_primer/meta.json` и captures.
- **Условия** — server-driven definitions: 111 condition types, 52 widget types (`boolean_checkboxes`, `tags_extended`, `period_money`, `bet`, …) в `test_primer/conditions.json`; подписи полей дублируются в `filters.inputs.*` bundle i18n.
- **Целевые действия** — i18n `gamification_tasks.target_actions`: 16 action types, per-action `requirements` fields; payload `{ action, requirements, conditions }`.
- **API payload** — `{ gamification_task: { … } }`, snake_case (как в `buildCreatePayload` / captures).

**Сравнение с `copy-panel.js`:**

| Блок | Админка | copy-panel (2.8.0) |
|------|---------|-------------------|
| Секции | 7 (+ targeting внутри формы) | 9 (явный «Таргетинг», «Прочие») |
| filter_id, events, tags, bonuses | select из meta | select (Phase 1) |
| conditions | conditions-builder (Phase 2) | виджеты + JSON fallback |
| actions | actions builder (Phase 3) | actions-builder (виджеты + JSON fallback) |
| cron | cron-input widget | text |

**Рекомендация:**

| Подход | Оценка |
|--------|--------|
| Встроить admin bundle в extension | ❌ — ~4.4 MB, auth/session, CSP, Vue+Ant Design |
| Извлечь переиспользуемую schema без bundle | ✅ — meta API + `conditions.json` + i18n-ключи из bundle |
| Сохранить lazy chunks (`form-Bg1PQAgX.js`) | ⏸️ — даст точную разметку секций, но дублирует API-driven schema |
| Постепенно улучшать `copy-panel` | ✅ — контролируемо, без зависимости от админки |

**Извлечённая schema:** [`exports/panel_schema_extracted.json`](exports/panel_schema_extracted.json) — секции, поля с UI-типами, 52 condition widget types, action builder structure, meta endpoints, сравнение с copy-panel.

**Приоритетный план для copy-panel:**

1. **Meta selects** — ✅ Phase 1 (2.9.0): `tasks/meta` → `<select>` для events, filter_id, tags, bonuses, notification_events, category, priority, type.
2. **Condition widgets** — ✅ Phase 2 (2.10.0): `filters/conditions` → builder с top widget types + JSON fallback.
3. **Action builder** — ✅ Phase 3 (2.11.0): picker action type + динамические поля requirements из extracted schema.
