import path from "node:path";

import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // WxtVitest подставляет fake-browser вместо wxt/browser и алиасы (@/ → app/).
  plugins: [WxtVitest()],
  resolve: {
    alias: {
      // Старый код как эталон в тестах паритета (см. tests/legacy.d.ts).
      legacy: path.resolve(import.meta.dirname, "src/shared"),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
