/** Ответ консультанта с разметкой: #id задач на канве — чипы «показать на канве». */
import { Fragment, useMemo } from "react";

import { cn } from "@/lib/utils";

import { type Block, type Inline, type ListItem, parseChatMarkdown } from "./chat-markdown";
import { useChainsStore } from "./store";

type FocusNode = (id: string) => void;

function TaskChip({ id, onFocusNode }: { id: string; onFocusNode: FocusNode }) {
  const name = useChainsStore((s) => s.canvas[id]?.name);
  if (name === undefined) {
    return <span className="font-mono text-muted-foreground">#{id}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onFocusNode(id)}
      title={`${name || "Без названия"} — показать на канве`}
      className="mx-px inline-flex cursor-pointer items-center rounded-chip bg-primary/12 px-1.5 font-mono text-caption leading-[18px] text-primary transition-colors hover:bg-primary/25"
    >
      #{id}
    </button>
  );
}

function InlineNodes({ nodes, onFocusNode }: { nodes: Inline[]; onFocusNode: FocusNode }) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "br":
        return <br key={index} />;
      case "code":
        return (
          <code
            key={index}
            className="rounded-[4px] bg-surface-2 px-1 py-px font-mono text-caption text-foreground"
          >
            {node.text}
          </code>
        );
      case "task":
        return <TaskChip key={index} id={node.id} onFocusNode={onFocusNode} />;
      case "bold":
        return (
          <strong key={index} className="font-semibold text-foreground">
            <InlineNodes nodes={node.children} onFocusNode={onFocusNode} />
          </strong>
        );
    }
  });
}

function List({
  ordered,
  items,
  onFocusNode,
  nested = false,
}: {
  ordered: boolean;
  items: ListItem[];
  onFocusNode: FocusNode;
  nested?: boolean;
}) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "flex flex-col gap-1 pl-4 marker:text-muted-foreground",
        ordered ? "list-decimal" : "list-disc",
        nested && "mt-1",
      )}
    >
      {items.map((item, index) => (
        <li key={index} className="pl-0.5">
          <InlineNodes nodes={item.inline} onFocusNode={onFocusNode} />
          {item.children.length ? (
            <List ordered={false} items={item.children} onFocusNode={onFocusNode} nested />
          ) : null}
        </li>
      ))}
    </Tag>
  );
}

function BlockNode({ block, onFocusNode }: { block: Block; onFocusNode: FocusNode }) {
  switch (block.kind) {
    case "heading":
      return (
        <h3 className="pt-1 text-subhead font-semibold text-foreground">
          <InlineNodes nodes={block.inline} onFocusNode={onFocusNode} />
        </h3>
      );
    case "paragraph":
      return (
        <p>
          <InlineNodes nodes={block.inline} onFocusNode={onFocusNode} />
        </p>
      );
    case "list":
      return <List ordered={block.ordered} items={block.items} onFocusNode={onFocusNode} />;
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-caption">
          {block.text}
        </pre>
      );
  }
}

export function ChatMarkdown({ text, onFocusNode }: { text: string; onFocusNode: FocusNode }) {
  // Разбор — по тексту: открытие отзыва или смена оценки ответ заново не разбирают.
  const blocks = useMemo(() => parseChatMarkdown(text), [text]);
  return (
    <div className="flex flex-col gap-2 text-subhead leading-[20px] break-words">
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} onFocusNode={onFocusNode} />
      ))}
    </div>
  );
}
