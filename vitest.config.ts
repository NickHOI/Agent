import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}apps/web/src`,
      "@donelayer/shared": `${root}packages/shared/src/index.ts`,
      "@donelayer/task-state-machine": `${root}packages/task-state-machine/src/index.ts`,
      "@donelayer/matching": `${root}packages/matching/src/index.ts`,
      "@donelayer/proof-of-done": `${root}packages/proof-of-done/src/index.ts`,
      "@donelayer/database": `${root}packages/database/src/index.ts`,
      "@donelayer/worker-protocol": `${root}packages/worker-protocol/src/index.ts`,
      "@donelayer/agent-adapters": `${root}packages/agent-adapters/src/index.ts`
    }
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/authorization/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    coverage: {
      reporter: ["text", "html"],
      include: ["packages/**/*.ts", "apps/web/src/server/**/*.ts"]
    }
  }
});
