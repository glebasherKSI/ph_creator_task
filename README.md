# PromoHub конструктор задач (Chrome MV3)

Расширение для работы с заданиями геймификации PromoHub: редактор задач, конструктор связей
между задачами на канве, статистика из Reports и импорт пакетов из Promo Graphic.

**Версия:** 3.0.0 — WXT + React + TypeScript. История миграции и дизайн-система: `docs/MIGRATION_PLAN.md`.

## Запуск

```
npm install
npm run dev          # Chrome с расширением из .output/chrome-mv3, HMR
npm run build        # прод-сборка в .output/chrome-mv3
npm run zip          # архив для установки
npm run check        # tsc + eslint + prettier + vitest
```

Распакованная установка: `chrome://extensions` → «Загрузить распакованное» → `.output/chrome-mv3`.
ID расширения зафиксирован ключом в манифесте (`ebpabdcmngdgiallonghpgddgcedebka`), поэтому не зависит
от папки. Перенос данных со старой установки — экспорт/импорт JSON в тулбаре конструктора
(см. `docs/EXTENSION_ID.md`).

## Страницы

| Страница        | Что делает                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| popup           | Домены админок и статус входа, вход в Promo Graphic, готовность Reports, переходы                                                                      |
| `editor.html`   | Список задач домена, копия / правка задачи в форме, статистика                                                                                         |
| `chains.html`   | Канва связей (React Flow): карточки задач, связи `gamification_tasks`, панель связи, сохранение PATCH, шаблоны, подписи, пакеты из Graphic, статистика |
| `showcase.html` | Витрина компонентов и дизайн-системы, форма на фикстурах                                                                                               |

## Структура

```
app/
  entrypoints/      background.ts, admin.content.ts (runtime-инъекция), popup/, editor/, chains/, showcase/
  lib/              логика без UI: api, auth/, tasks, task-api, meta, storage, messaging, schemas, graphic, reports…
  features/
    popup/          карточки и хуки popup
    auth/           AuthProvider + модалка входа (magic link → OTP)
    task-form/      TaskForm и виджеты: условия, действия, страны, расписание
    editor/         список задач, страница редактора
    stats/          агрегация отчётов и панель статистики (Recharts)
    chains/         канва: graph.ts (связи ↔ conditions), layout.ts, store.ts (Zustand), React Flow UI
  components/       UI-примитивы (Radix, стиль shadcn) и составные компоненты; конвенции — components/README.md
  assets/globals.css  токены дизайн-системы (тёмная тема, Inter)
public/             иконки, фикстуры справочников (test_primer), dev-shim.js
tests/              Vitest; tests/legacy — старый JS как эталон для тестов паритета
docs/               план миграции, ID расширения
```

## Как устроено общение с бэком

Страницы не ходят в сеть сами: запросы к admin API идут через background (`PH_ADMIN_API_FETCH`),
который делает fetch из контекста открытой вкладки админки (cookie сессии) или из service worker.
Вход — magic link + OTP (`features/auth`). Reports запрашиваются через открытую вкладку
`reports.maxbit.private`, Promo Graphic — по токену. Реестр сообщений: `app/lib/messaging.ts`.

## Разработка

- Витрину и редактор можно открыть вне расширения (например, со статического сервера над
  `.output/chrome-mv3`): `public/dev-shim.js` подставляет заглушку `chrome.*`, в расширении он бездействует.
- Линтер React Compiler запрещает `setState` синхронно в эффектах и чтение `ref.current` в рендере.
- Тесты паритета сравнивают новый TypeScript со старым JS (`tests/legacy`) на фикстурах из HAR
  (`tests/fixtures/har`).
