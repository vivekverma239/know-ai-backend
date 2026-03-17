import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000, // 30s per test (E2E can be slow)
    hookTimeout: 15000,
    include: ["test/**/*.e2e.ts", "test/**/*.test.ts"],
    exclude: [
      // Legacy ad-hoc tests (kept for backwards compatibility)
      "test/chatStream.test.ts",
      "test/docParsing.test.ts",
      "test/ingestionWebhook.test.ts",
      "test/adminDashboard.test.ts",
      "test/e2e-ingestion.test.ts",
      "test/e2e-ingestion-webhook.test.ts",
      "test/smokeTest.ts",
      "test/finAgentTest.ts",
    ],
    setupFiles: ["test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
