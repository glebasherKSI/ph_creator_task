import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

/** Публичный ключ фиксирует ID расширения: см. docs/EXTENSION_ID.md. */
const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAgx3p8N1B4cgw/kmZfH+PdmY6IWNMUygE3ZsJmO58W1fUbSiYspjaOB9/bH4Js6QL95REKX1POlU14It4H067Nh3vZJub4MMjj/CEvBZrOnms/gEnWiiJNbMryHgXYsLUsdQKeZ7N8gw/fPY3+AFGDgg4XWAJEfqPalMhf3z7iEE6eOkiKOro4ylqTSzoKdXKdrfZ619LbVbnYAKbnhpElnoS+5sYKDBfautJZTn1n0L1RKf7NeaYmHn/G92GWOMQb9uPV0cqscVHpvpvTa12E05NS5t1Zm1gSleKagsbe1Y4kM7FlhkbKLjEMWPe5tzbRzk8gJrFL6yLYDrTx6+A+wIDAQAB";

export default defineConfig({
  srcDir: "app",
  modules: ["@wxt-dev/module-react"],
  // Явные импорты из "wxt/browser" и "wxt/utils/*" вместо авто-импортов — проще для TS и линта.
  imports: false,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "PromoHub конструктор задач",
    description: "Управление доменами PromoHub admin и переход в конструктор связей задач.",
    key: EXTENSION_KEY,
    action: {
      default_title: "PromoHub конструктор задач",
    },
    permissions: ["storage", "tabs", "scripting", "cookies"],
    host_permissions: [
      "https://reports.maxbit.private/*",
      "http://127.0.0.1:8000/*",
      "http://localhost:8000/*",
    ],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    web_accessible_resources: [
      {
        resources: ["test_primer/conditions.json", "test_primer/constant.json"],
        matches: ["https://*/*"],
      },
    ],
  },
});
