import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // pnpm runs scripts from apps/web, so the monorepo root is two levels up.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@mastertutor/contracts", "@mastertutor/db"],
  poweredByHeader: false,
  compiler: {
    // The fixture API exists only in builds made for UI tests. A production build (no
    // WEB_FIXTURE_API at build time) folds this to false, so the fixture router, seed and
    // placeholder assets are never emitted (scripts/check-prod-bundle.ts proves it).
    defineServer: {
      __FIXTURE_BUILD__: ["1", "true"].includes(process.env["WEB_FIXTURE_API"] ?? ""),
    },
  },
};

export default config;
