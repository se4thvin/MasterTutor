import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const exclude = ["**/node_modules/**", "**/.next/**"];

export default defineConfig({
  // next.config.ts defines this for web builds; tests run as a production (non-fixture) build.
  define: { __FIXTURE_BUILD__: "false" },
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/", import.meta.url)) }],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "apps/**/*.test.ts",
            "scripts/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
          exclude: [
            ...exclude,
            "**/*.int.test.ts",
            "**/*.behaviour.test.ts",
            "**/*.security.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["packages/**/*.int.test.ts", "apps/**/*.int.test.ts", "tests/**/*.int.test.ts"],
          exclude,
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "security",
          include: [
            "apps/**/*.security.test.ts",
            "packages/**/*.security.test.ts",
            "tests/**/*.security.test.ts",
          ],
          exclude,
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "behaviour",
          include: ["tests/behaviour/**/*.behaviour.test.ts", "apps/**/*.behaviour.test.ts"],
          exclude,
          globalSetup: ["tests/behaviour/global-setup.ts"],
          // Every file starts from the same stack state, so files pass in any order (isolate.ts).
          setupFiles: ["tests/behaviour/isolate.ts"],
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
