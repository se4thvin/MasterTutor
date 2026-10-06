import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // pnpm runs scripts from apps/web, so the monorepo root is two levels up.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@mastertutor/contracts", "@mastertutor/db"],
  poweredByHeader: false,
};

export default config;
