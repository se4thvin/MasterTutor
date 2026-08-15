import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import motionPlugin from "./apps/web/lint/motion-eslint-plugin.ts";

const ANIMATION_BANS = {
  group: ["gsap", "gsap/*", "ogl", "framer-motion", "matter-js", "@react-three/*", "@hugeicons/*"],
  message:
    "motion is the animation library and icons come from components/ui/icons.ts (spec §11.3–11.4). D43 allows gsap/ogl/WebGL only when worth it, behind a reviewed import() boundary like layout-features.",
};
const THREE_BAN = {
  group: ["three", "three/*"],
  message: "three may be imported only from components/hero/.",
};
const LUCIDE_BAN = { group: ["lucide-react"], message: "Use <Icon> from components/ui/icon.tsx." };
// P7-14: the fixture API (apps/web/lib/fixtures) is a test double. Runtime web code reaches it only
// through the entry points gated by __FIXTURE_BUILD__ and WEB_FIXTURE_API, which check:bundle and
// tests/compose/no-fixture-api.test.ts guard; the allow block below lists them.
const FIXTURES = "@/lib/fixtures";
const FIXTURES_BAN = {
  group: [`${FIXTURES}/*`, "**/fixtures/*"],
  message:
    "Runtime web code talks to the real API. The fixture API is for tests, the Playwright suites and the gated entry points only (P7-14).",
};
// Spec §3.1: web seals with the public key and never opens a box. Only the integration test that
// plays the agent may import the opening entry (W9); key-placement.test.ts proves this rule.
const SEALING_OPEN = "@mastertutor/sealing/open";
const SEALING_OPEN_BAN = {
  group: [SEALING_OPEN],
  message: "web can seal but never open: @mastertutor/sealing/open is agent-only (spec §3.1).",
};
/** `motion` defeats LazyMotion; `domMax` (layout animation, ~14 kB gz) must stay out of first-load JS (D43). */
const motionImportBan = (importNames) =>
  ["motion/react", "motion/react-client"].map((name) => ({
    name,
    importNames,
    message:
      "Use m.* inside LazyMotion; layout animation (domMax) loads only through <LayoutMotion> (spec §11.4, D43).",
  }));
const MOTION_COMPONENT_BAN = motionImportBan(["motion", "domMax"]);
/** The lazy boundary: layout-features is reached only by import() in components/motion/layout-motion.tsx. */
const LAYOUT_FEATURES_STATIC = {
  regex: "(^|/)layout-features(\\.ts)?$",
  message: "Load layout-features only with import(), inside <LayoutMotion> (D43 lazy boundary).",
};
// Every apps/web no-restricted-imports block replaces the earlier one, so it must carry the D38
// OpenAI import ban, the D43 boundary and the sealing ban too.
const webImports = (
  patterns,
  { paths = MOTION_COMPONENT_BAN, sealingOpen = false, fixtures = true } = {},
) => [
  "error",
  {
    paths,
    patterns: [
      ANIMATION_BANS,
      LAYOUT_FEATURES_STATIC,
      OPENAI_IMPORTS,
      ...(sealingOpen ? [] : [SEALING_OPEN_BAN]),
      ...(fixtures ? [FIXTURES_BAN] : []),
      ...patterns,
    ],
  },
];

// D38: stateful OpenAI APIs. Every block that sets no-restricted-syntax for apps/** must include
// these, because a later block's no-restricted-syntax replaces an earlier one's.
const OPENAI_STATEFUL_BANS = [
  {
    selector:
      "MemberExpression[property.name=/^(files|vectorStores|conversations|batches|fineTuning|evals)$/]:matches([object.name=/^(openai|client|openaiClient)$/i], [object.property.name=/^(openai|client|openaiClient)$/i])",
    message:
      "Stateful OpenAI APIs are banned (openai-data-policy.md): use Responses with store:false, embeddings or transcription only.",
  },
  {
    selector:
      "MemberExpression[object.property.name='beta'][property.name=/^(assistants|threads)$/]",
    message: "Assistants and Threads are banned (openai-data-policy.md).",
  },
];
/** Dynamic import() is how banned libraries usually sneak in; it needs its own selector. */
const dynamicImportBan = (groups) => [
  "error",
  ...OPENAI_STATEFUL_BANS,
  {
    selector: `ImportExpression[source.value=/^(${groups.map((group) => group.replaceAll("/", "\\/")).join("|")})(\\/|$)/]`,
    message: "This library may not be imported here, dynamically or statically (spec §11.3–11.4).",
  },
];
// D43: a library leaves this list only together with a lazy import() boundary like
// LAYOUT_FEATURES_STATIC. Nothing in the delight pass needs one.
const ALL_BANNED = [
  "gsap",
  "ogl",
  "framer-motion",
  "matter-js",
  "@react-three",
  "@hugeicons",
  SEALING_OPEN,
  FIXTURES,
];

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
      "apps/web/test-results/**",
      "apps/web/playwright-report/**",
      "orchestration/**",
      "design/**",
      "docs/**",
      // Nested git worktrees hold other branches' code (gitignored).
      ".worktrees/**",
      // Built React fixture bundle (gitignored, generated by build-react.ts).
      "tests/fixtures/vault-sites/.dist/**",
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
    // CLAUDE.md 5, 6: the benchmark harness reads the product only through @mastertutor/contracts,
    // never an app's source. This block replaces the one above, so it carries the OpenAI ban too.
    files: ["tests/bench/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            OPENAI_IMPORTS,
            {
              regex: "(^|/)apps/[^/]+/src(/|$)",
              message:
                "tests/bench may not import an app's source; share the shape through @mastertutor/contracts.",
            },
          ],
        },
      ],
    },
  },
  {
    // Scoped to OpenAI client objects (`openai`, `client`, `this.client`, `x.openai`), so DOM
    // `input.files` or `dataTransfer.files` stay legal. The import ban above is the real boundary.
    files: ["apps/**/*.{ts,tsx}", "packages/*/src/server/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...OPENAI_STATEFUL_BANS],
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
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, motion: motionPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "motion/no-raw-motion": "error",
      "motion/no-raw-motion-classes": "error",
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN]),
      "no-restricted-syntax": dynamicImportBan([...ALL_BANNED, "three", "lucide-react"]),
    },
  },
  {
    // P7-14: the fixture API's own module, its gated entry points, tests and the Playwright suites.
    files: [
      "apps/web/lib/fixtures/**",
      "apps/web/app/api/rpc/*/route.ts",
      "apps/web/app/api/assets/*/route.ts",
      "apps/web/lib/server/viewer.ts",
      "apps/web/**/*.test.{ts,tsx}",
      "apps/web/e2e/**",
      "apps/web/playwright*.config.ts",
    ],
    rules: {
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN], { fixtures: false }),
      "no-restricted-syntax": dynamicImportBan([
        ...ALL_BANNED.filter((name) => name !== FIXTURES),
        "three",
        "lucide-react",
      ]),
    },
  },
  {
    // The one static home of domMax; layout-motion.tsx reaches it only through import().
    files: ["apps/web/components/motion/layout-features.ts"],
    rules: {
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN], {
        paths: motionImportBan(["motion"]),
      }),
    },
  },
  {
    // W9: this one integration test plays the agent to prove what web sealed; nothing else may.
    files: ["apps/web/lib/server/rpc/vault.int.test.ts"],
    rules: {
      "no-restricted-imports": webImports([THREE_BAN, LUCIDE_BAN], {
        sealingOpen: true,
        fixtures: false,
      }),
      "no-restricted-syntax": dynamicImportBan([
        ...ALL_BANNED.filter((name) => name !== SEALING_OPEN && name !== FIXTURES),
        "three",
        "lucide-react",
      ]),
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
    rules: {
      "no-restricted-imports": webImports([THREE_BAN]),
      "no-restricted-syntax": dynamicImportBan([...ALL_BANNED, "three"]),
    },
  },
  {
    files: ["apps/web/components/hero/**"],
    rules: {
      "no-restricted-imports": webImports([LUCIDE_BAN]),
      "no-restricted-syntax": dynamicImportBan([...ALL_BANNED, "lucide-react"]),
    },
  },
  prettier,
);
