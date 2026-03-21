import { stat } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";

const here = import.meta.dirname;
const entry = path.join(here, "react-login.ts");
const outDir = path.join(here, ".dist");

/** Bundles the React fixture once (cached by mtime) into .dist/react-login.js. */
export async function buildReactLogin(): Promise<string> {
  const out = path.join(outDir, "react-login.js");
  const [source, built] = await Promise.all([stat(entry), stat(out).catch(() => null)]);
  if (built && built.mtimeMs >= source.mtimeMs) return out;
  await build({
    configFile: false,
    root: here,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { input: entry, output: { format: "iife", entryFileNames: "react-login.js" } },
    },
  });
  return out;
}
