# Конвенции UI-компонентов

Правила для всех компонентов в `app/components` и `app/features`.

## Стек и стиль

- React 19 + TypeScript strict, Tailwind v4, примитивы в стиле shadcn/ui на Radix (`app/components/ui`).
- Цвета только через токены: `bg-background`, `bg-surface`, `bg-surface-2`, `bg-input`, `text-foreground`,
  `text-muted-foreground`, `bg-primary` / `text-primary` (оранжевый акцент), `bg-destructive`, `bg-success`,
  `border-border`. Никаких hex в компонентах.
- Шрифтовые классы: `text-large-title`, `text-title-1`, `text-title-2`, `text-headline`, `text-body`,
  `text-subhead`, `text-caption`. Скругления: `rounded-lg` (карточки), `rounded-md` (поля), `rounded-chip`.
- Рамка только у активного/выбранного элемента, и она `border-primary`. Поля ввода — `bg-input` без рамки.
- Классы склеивать через `cn()` из `@/lib/utils`.

## Контракты компонентов

- Компоненты **controlled**: `value` + `onChange(next)`, без внутренних копий значения
  (локальный state только для UI: открыт/закрыт, строка поиска, черновик ввода).
- Никаких `mount*()`/императивных API из старого кода. Асинхронные данные (схемы, справочники)
  приходят через props или хуки, которые возвращают `{ data, loading, error }`.
- Чистую логику (парсинг, нормализация, маппинг) выносить в `*.ts` рядом с компонентом и покрывать
  тестами в `tests/features/**`; тесты паритета со старым JS — через алиас `legacy/<file>.js`.
- Доступность: у кнопок-иконок `aria-label`, у полей `<Label htmlFor>` или `aria-label`.
- Иконки — `lucide-react`.

## Готовые примитивы (`app/components/ui`)

`Button` (variant: primary | secondary | outline | ghost | destructive; size: sm | md | lg | icon | icon-sm),
`Input`, `Textarea`, `Label`, `Badge`, `Card*`, `Segmented`, `Checkbox` / `CheckboxField`, `Switch` / `SwitchField`,
`SimpleSelect` (+ низкоуровневые `Select*`), `Popover*`, `Dialog*` / `SheetContent`, `Tooltip*`, `Collapsible*`,
`Command*` (cmdk). Составной: `MultiCombobox` (`app/components/multi-combobox.tsx`).

## Проверки

`npm run check` = `tsc --noEmit` + `eslint` + `prettier --check` + `vitest run`. Линтер React Compiler
запрещает `setState` синхронно в `useEffect` и чтение `ref.current` во время рендера — производное состояние
считать в рендере, подписки класть в эффекты.
