import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

/**
 * Service worker нового расширения.
 * Логика старого background.js переезжает сюда на этапе 3 (docs/MIGRATION_PLAN.md).
 */
export default defineBackground(() => {
  console.info("[ph-creator-task] background started", { id: browser.runtime.id });
});
