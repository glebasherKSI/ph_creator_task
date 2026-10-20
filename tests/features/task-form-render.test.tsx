/**
 * Смоук-рендер формы задачи (SSR): ловит ошибки рендера всех секций и виджетов
 * на реальных фикстурах. Хуки с данными отдают пустое состояние — ничего не грузится.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskForm } from "@/features/task-form/TaskForm";
import type { TaskLike } from "@/lib/types";

import taskInteractive from "../fixtures/har/task-interactive-1454.json";
import taskSequence from "../fixtures/har/task-sequence-1456.json";
import taskWithGt from "../fixtures/har/task-with-gamification-tasks-1366.json";

describe("TaskForm — смоук-рендер", () => {
  it.each([
    ["interactive", taskInteractive],
    ["sequence", taskSequence],
    ["with gamification_tasks", taskWithGt],
  ])("%s", (_name, task) => {
    const html = renderToString(
      <TaskForm mode="copy" domain="" sourceTask={task as TaskLike} onSubmit={async () => {}} />,
    );
    expect(html).toContain("Параметры копии");
    expect(html).toContain("Основное");
    expect(html).toContain("Целевые действия");
  });

  it("без исходной задачи — кнопки недоступны", () => {
    const html = renderToString(
      <TaskForm mode="edit" domain="" sourceTask={null} onSubmit={async () => {}} />,
    );
    expect(html).toContain("Параметры задачи");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Сохранить/);
  });
});
