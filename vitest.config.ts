import { defineConfig } from "vitest/config";

const exclude = ["**/node_modules/**", "**/.next/**"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "apps/**/*.test.ts",
            "scripts/**/*.test.ts",
            "tests/**/*.test.ts",
          ],
          exclude: [...exclude, "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/**/*.int.test.ts", "apps/**/*.int.test.ts", "tests/**/*.int.test.ts"],
          exclude,
          testTimeout: 120_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
