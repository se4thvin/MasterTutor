import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const OPENAI_IMPORTS = {
  group: ["openai", "openai/*"],
  message:
    "Import OpenAI only through apps/agent/src/llm/openai.ts (stateless factory, openai-data-policy.md).",
};

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/db/migrations/**",
      "orchestration/**",
      "design/**",
      "docs/**",
      // Nested git worktrees hold other branches' code (gitignored).
      ".worktrees/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // OpenAI data-minimisation policy (D38): one client factory, stateless endpoints only.
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["apps/agent/src/llm/openai.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [OPENAI_IMPORTS] }],
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/*/src/server/**/*.ts"],
    ignores: ["apps/web/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^(files|vectorStores|conversations|batches|fineTuning|evals)$/]",
          message:
            "Stateful OpenAI APIs are banned (openai-data-policy.md): use Responses with store:false, embeddings or transcription only.",
        },
        {
          selector:
            "MemberExpression[object.property.name='beta'][property.name=/^(assistants|threads)$/]",
          message: "Assistants and Threads are banned (openai-data-policy.md).",
        },
      ],
    },
  },
  {
    files: ["packages/contracts/src/**/*.ts"],
    ignores: ["packages/contracts/src/server/**", "packages/contracts/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            OPENAI_IMPORTS,
            {
              group: ["node:*", "pino"],
              message:
                "The contracts root entry must stay browser-safe; put Node-only code in src/server/.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
