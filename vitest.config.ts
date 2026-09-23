import { defineConfig } from "vitest/config";

export default defineConfig({
  // Playwright owns e2e/.
  test: { include: ["test/**/*.test.{ts,tsx}"] },
});
