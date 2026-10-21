import { useState } from "react";
import { browser } from "wxt/browser";

import { Button } from "@/components/ui/button";
import { DomainsCard } from "@/features/popup/DomainsCard";
import { GraphicCard } from "@/features/popup/GraphicCard";
import { ReportsCard } from "@/features/popup/ReportsCard";
import { type PopupTab, StatusTabs } from "@/features/popup/StatusTabs";
import {
  backendTone,
  formatAuthTitle,
  graphicTone,
  reportsReadiness,
  reportsTone,
} from "@/features/popup/labels";
import { useDomains } from "@/features/popup/useDomains";
import { useGraphic } from "@/features/popup/useGraphic";
import { useReports } from "@/features/popup/useReports";

/** Страница конструктора связей (канва React Flow). */
const CONSTRUCTOR_PAGE = "/chains.html";
const TAB_KEY = "ph_popup_tab";

function readLastTab(): PopupTab {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    return raw === "graphic" || raw === "reports" ? raw : "backend";
  } catch {
    return "backend";
  }
}

export function App() {
  const version = browser.runtime.getManifest().version;
  const [tab, setTab] = useState<PopupTab>(readLastTab);
  const domains = useDomains();
  const graphic = useGraphic();
  const reports = useReports();

  function selectTab(next: PopupTab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* необязательно */
    }
  }

  function openConstructor() {
    void browser.tabs.create({ url: browser.runtime.getURL(CONSTRUCTOR_PAGE) });
  }

  const readiness = reportsReadiness(reports.status);
  const backendTitle = domains.domains
    .map((host) => `${host}: ${formatAuthTitle(domains.auth[host])}`)
    .join("\n");

  return (
    <div className="flex w-[380px] flex-col gap-3 p-3">
      <header className="flex items-baseline justify-between px-1">
        <h1 className="text-title-2">PromoHub конструктор задач</h1>
      </header>

      <StatusTabs
        value={tab}
        onValueChange={selectTab}
        items={[
          {
            value: "backend",
            label: "Бэкенд",
            tone: backendTone(domains.auth, domains.domains),
            title: backendTitle || "Нет доменов",
          },
          {
            value: "graphic",
            label: "Graphic",
            tone: graphicTone(graphic.status),
            title: graphic.status?.authenticated ? "Подключено" : "Нет входа",
          },
          {
            value: "reports",
            label: "Отчёты",
            tone: reportsTone(readiness),
            title:
              readiness === "ready"
                ? "Сессия и вкладка есть"
                : readiness === "no-session"
                  ? "Нет сессии Reports"
                  : readiness === "no-tab"
                    ? "Откройте вкладку Reports"
                    : "Проверяю…",
          },
        ]}
      />

      {tab === "backend" ? <DomainsCard state={domains} /> : null}
      {tab === "graphic" ? <GraphicCard state={graphic} /> : null}
      {tab === "reports" ? <ReportsCard state={reports} /> : null}

      {tab === "backend" && domains.status ? (
        <p role="status" className="px-1 text-caption text-muted-foreground">
          {domains.status}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button variant="primary" size="lg" onClick={openConstructor}>
          Перейти в конструктор
        </Button>
      </div>

      <footer className="flex items-center justify-center gap-1.5 pb-1 text-caption text-muted-foreground">
        <span>DEVPRECISION INSIGHT</span>
        <span aria-hidden="true">•</span>
        <span>V{version}</span>
      </footer>
    </div>
  );
}
