import { browser } from "wxt/browser";

import { Button } from "@/components/ui/button";
import { DomainsCard } from "@/features/popup/DomainsCard";
import { GraphicCard } from "@/features/popup/GraphicCard";
import { useDomains } from "@/features/popup/useDomains";
import { useGraphic } from "@/features/popup/useGraphic";

/** Страница конструктора появится на этапе 7; до тех пор кнопка ведёт на витрину. */
const CONSTRUCTOR_PAGE = "/showcase.html";

export function App() {
  const version = browser.runtime.getManifest().version;
  const domains = useDomains();
  const graphic = useGraphic();

  function openConstructor() {
    void browser.tabs.create({ url: browser.runtime.getURL(CONSTRUCTOR_PAGE) });
  }

  return (
    <div className="flex w-[380px] flex-col gap-3 p-3">
      <header className="flex items-baseline justify-between px-1">
        <h1 className="text-title-2">PromoHub конструктор задач</h1>
      </header>

      <DomainsCard state={domains} />
      <GraphicCard state={graphic} />

      {domains.status ? (
        <p role="status" className="px-1 text-caption text-muted-foreground">
          {domains.status}
        </p>
      ) : null}

      <Button variant="primary" size="lg" onClick={openConstructor}>
        Перейти в конструктор
      </Button>

      <footer className="flex items-center justify-center gap-1.5 pb-1 text-caption text-muted-foreground">
        <span>DEVPRECISION INSIGHT</span>
        <span aria-hidden="true">•</span>
        <span>V{version}</span>
      </footer>
    </div>
  );
}
