/**
 * Разметка ответов консультанта: небольшое подмножество markdown → дерево для React.
 * Свой разбор вместо библиотеки: HTML из ответа модели никогда не попадает в DOM, а нужны
 * только абзацы, подзаголовки, списки (один уровень вложенности), **жирный**, `код` и #id задач.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "task"; id: string }
  | { kind: "br" };

export interface ListItem {
  inline: Inline[];
  children: ListItem[];
}

export type Block =
  | { kind: "heading"; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "code"; text: string };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(#(?:local_[\w-]+|\d+))/g;
const HEADING = /^#{1,6}\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
/** Отступ, с которого пункт считается вложенным. */
const NESTED_INDENT = 2;

export function parseInline(text: string, allowBold = true): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token, code, bold, task] = match;
    const start = match.index;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    if (code) out.push({ kind: "code", text: code.slice(1, -1) });
    else if (bold && allowBold)
      out.push({ kind: "bold", children: parseInline(bold.slice(2, -2), false) });
    else if (bold) out.push({ kind: "text", text: bold });
    else if (task) out.push({ kind: "task", id: task.slice(1) });
    last = start + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseChatMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const inline: Inline[] = [];
    paragraph.forEach((line, index) => {
      if (index) inline.push({ kind: "br" });
      inline.push(...parseInline(line));
    });
    blocks.push({ kind: "paragraph", inline });
    paragraph = [];
  };
  const flushAll = () => {
    flushParagraph();
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (code) {
      if (raw.trim().startsWith("```")) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    const line = raw.trimEnd();
    if (line.trim().startsWith("```")) {
      flushAll();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    const heading = HEADING.exec(line.trim());
    if (heading) {
      flushAll();
      blocks.push({ kind: "heading", inline: parseInline(heading[1]!) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const [, indent = "", marker = "", text = ""] = item;
      const entry: ListItem = { inline: parseInline(text), children: [] };
      const current = list as Extract<Block, { kind: "list" }> | null;
      if (indent.length >= NESTED_INDENT && current?.items.length) {
        current.items.at(-1)!.children.push(entry);
        continue;
      }
      const ordered = /\d/.test(marker);
      if (!current || current.ordered !== ordered) {
        list = { kind: "list", ordered, items: [] };
        blocks.push(list);
      }
      list!.items.push(entry);
      continue;
    }
    const current = list as Extract<Block, { kind: "list" }> | null;
    if (current && /^\s/.test(line)) {
      // Продолжение пункта на следующей строке с отступом.
      const target = current.items.at(-1)!;
      const owner = target.children.at(-1) ?? target;
      owner.inline.push({ kind: "text", text: " " }, ...parseInline(line.trim()));
      continue;
    }
    list = null;
    paragraph.push(line.trim());
  }
  if (code) blocks.push({ kind: "code", text: (code as string[]).join("\n") });
  flushParagraph();
  return blocks;
}
