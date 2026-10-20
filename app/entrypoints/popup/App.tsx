import { browser } from "wxt/browser";

import { Button } from "@/components/ui/button";

/**
 * Временный popup нового стека. Полноценный popup — этап 4 плана миграции.
 */
export function App() {
  const version = browser.runtime.getManifest().version;

  function openShowcase() {
    void browser.tabs.create({ url: browser.runtime.getURL("/showcase.html") });
  }

  return (
    <div className="flex w-[360px] flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-title-2">PromoHub конструктор задач</h1>
        <span className="text-caption text-muted-foreground">v{version}</span>
      </header>
      <p className="text-subhead text-muted-foreground">
        Новая сборка на WXT + React. Старое расширение продолжает работать отдельно, пока идёт
        миграция.
      </p>
      <Button variant="primary" size="lg" onClick={openShowcase}>
        Открыть витрину компонентов
      </Button>
    </div>
  );
}
