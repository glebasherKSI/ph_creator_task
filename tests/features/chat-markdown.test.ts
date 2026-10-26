import { describe, expect, it } from "vitest";

import { parseChatMarkdown, parseInline } from "@/features/chains/chat-markdown";

describe("parseInline", () => {
  it("splits bold, code and task refs; bold may hold refs and code", () => {
    expect(parseInline("Задача #1366 ждёт **депозит от `100`** и #local_ab")).toEqual([
      { kind: "text", text: "Задача " },
      { kind: "task", id: "1366" },
      { kind: "text", text: " ждёт " },
      {
        kind: "bold",
        children: [
          { kind: "text", text: "депозит от " },
          { kind: "code", text: "100" },
        ],
      },
      { kind: "text", text: " и " },
      { kind: "task", id: "local_ab" },
    ]);
  });

  it("keeps markup characters literal when they are not markup", () => {
    expect(parseInline("2 * 3 и # не ссылка, <b>html</b>")).toEqual([
      { kind: "text", text: "2 * 3 и # не ссылка, <b>html</b>" },
    ]);
  });
});

describe("parseChatMarkdown", () => {
  it("builds headings, paragraphs and lists with one nesting level", () => {
    const blocks = parseChatMarkdown(
      [
        "Не связаны **2** задачи.",
        "",
        "### Без связей",
        "- #10 — депозит",
        "  - событие `deposit`",
        "- #20",
        "  продолжение пункта",
        "",
        "1. первый",
        "2. второй",
        "Итог одной строкой",
        "вторая строка",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "heading",
      "list",
      "list",
      "paragraph",
    ]);

    const bullets = blocks[2] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0]!.children[0]!.inline).toContainEqual({ kind: "code", text: "deposit" });
    expect(bullets.items[1]!.inline.at(-1)).toEqual({ kind: "text", text: "продолжение пункта" });

    const numbered = blocks[3] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(numbered.ordered).toBe(true);
    expect(numbered.items).toHaveLength(2);

    expect(blocks[4]).toEqual({
      kind: "paragraph",
      inline: [
        { kind: "text", text: "Итог одной строкой" },
        { kind: "br" },
        { kind: "text", text: "вторая строка" },
      ],
    });
  });

  it("keeps fenced code verbatim and tolerates an unclosed fence", () => {
    expect(parseChatMarkdown("```\n**не жирный** #1\n```")).toEqual([
      { kind: "code", text: "**не жирный** #1" },
    ]);
    expect(parseChatMarkdown("```json\n{}")).toEqual([{ kind: "code", text: "{}" }]);
  });
});
