import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import motionPlugin from "./apps/web/lint/motion-eslint-plugin.ts";

const ANIMATION_BANS = {
  group: ["gsap", "gsap/*", "ogl", "framer-motion", "matter-js", "@react-three/*", "@hugeicons/*"],
  message:
    "motion is the only animation library and icons come from components/ui/icons.ts (spec §11.3–11.4).",
};
const THREE_BAN = {
  group: ["three", "three/*"],
  message: "three may be imported only from components/hero/.",
};
const LUCIDE_BAN = { group: ["lucide-react"], message: "Use <Icon> from components/ui/icon.tsx." };
const MOTION_COMPONENT_BAN = {
  name: "motion/react",
  importNames: ["motion"],
  message: "Use m.* inside LazyMotion (spec §11.4).",
};
const webImports = (patterns) => [
  "error",
  { paths: [MOTION_COMPONENT_BAN], patterns: [ANIMATION_BANS, ...patterns] },
];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/db/migrations/**",
      "apps/web/test-results/**",
      "apps/web/playwright-report/**",
      "orchestration/**",
      "design/**",
      "docs/**",
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
    files: ["packages/contracts/src/**/*.ts"],
    ignores: ["packages/contracts/src/server/**", "packages/contracts/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, motion: motionPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "motion/no-raw-motion": "error",
      "motion/no-raw-motion-classes": "error",
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN]),
    },
  },
  {
    files: [
      "apps/web/lib/motion-tokens.ts",
      "apps/web/scripts/generate-motion-css.ts",
      "apps/web/lint/**",
    ],
    rules: { "motion/no-raw-motion": "off", "motion/no-raw-motion-classes": "off" },
  },
  {
    files: ["apps/web/components/ui/icons.ts"],
    rules: { "no-restricted-imports": webImports([THREE_BAN]) },
  },
  {
    files: ["apps/web/components/hero/**"],
    rules: { "no-restricted-imports": webImports([LUCIDE_BAN]) },
  },
  prettier,
);
