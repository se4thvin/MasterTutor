import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: new URL("../../../", import.meta.url).pathname });

async function rules(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "parse-error");
}

const WEB = "apps/web/components/x.tsx";
const HERO = "apps/web/components/hero/x.tsx";
const ICONS = "apps/web/components/ui/icons.ts";

describe("animation and icon import bans", () => {
  it.each(["gsap", "ogl", "framer-motion", "matter-js", "@react-three/fiber", "@hugeicons/react"])(
    "bans %s everywhere in apps/web, statically and dynamically",
    async (pkg) => {
      for (const file of [WEB, HERO, ICONS]) {
        expect(await rules(`import x from "${pkg}"; export default x;`, file)).toContain(
          "no-restricted-imports",
        );
        expect(await rules(`export const l = () => import("${pkg}");`, file)).toContain(
          "no-restricted-syntax",
        );
      }
    },
  );

  it("allows three only under components/hero", async () => {
    expect(await rules(`import * as T from "three"; export default T;`, HERO)).toEqual([]);
    expect(await rules(`export const l = () => import("three");`, HERO)).toEqual([]);
    expect(await rules(`import * as T from "three"; export default T;`, WEB)).toContain(
      "no-restricted-imports",
    );
    expect(await rules(`export const l = () => import("three");`, WEB)).toContain(
      "no-restricted-syntax",
    );
  });

  it("allows lucide-react only in components/ui/icons.ts", async () => {
    expect(await rules(`import { X } from "lucide-react"; export default X;`, ICONS)).toEqual([]);
    expect(await rules(`import { X } from "lucide-react"; export default X;`, WEB)).toContain(
      "no-restricted-imports",
    );
    expect(await rules(`export const l = () => import("lucide-react");`, WEB)).toContain(
      "no-restricted-syntax",
    );
  });

  it.each(["motion/react", "motion/react-client"])(
    "bans the full motion component from %s",
    async (source) => {
      expect(
        await rules(`import { motion } from "${source}"; export default motion;`, WEB),
      ).toContain("no-restricted-imports");
      expect(await rules(`import { m } from "${source}"; export default m;`, WEB)).toEqual([]);
    },
  );
});

describe("OpenAI import ban (D38)", () => {
  it("bans the openai SDK in web and the agent, and allows only the contracts factory", async () => {
    const code = `import OpenAI from "openai"; export default OpenAI;`;
    expect(await rules(code, "apps/web/lib/server/x.ts")).toContain("no-restricted-imports");
    expect(await rules(code, "apps/agent/src/x.ts")).toContain("no-restricted-imports");
    expect(await rules(code, "apps/agent/src/llm/openai.ts")).toContain("no-restricted-imports");
    expect(await rules(code, "packages/contracts/src/server/openai.ts")).toEqual([]);
    // Subpaths of the SDK are the SDK; the contracts factory's own subpath is the way in.
    expect(
      await rules(`export { zodTextFormat } from "openai/helpers/zod";`, "apps/agent/src/x.ts"),
    ).toContain("no-restricted-imports");
    expect(
      await rules(
        `export { createOpenAI } from "@mastertutor/contracts/server/openai";`,
        "apps/agent/src/x.ts",
      ),
    ).toEqual([]);
  });
});

describe("server-only contracts stay out of web client code (Task 0 review M1)", () => {
  const imports = [
    `import { createOpenAI } from "@mastertutor/contracts/server/openai"; export default createOpenAI;`,
    `import { createLogger } from "@mastertutor/contracts/server"; export default createLogger;`,
  ];
  it.each(["apps/web/components/x.tsx", "apps/web/app/(app)/page.tsx", "apps/web/lib/x.ts"])(
    "bans them in %s",
    async (file) => {
      for (const code of imports)
        expect(await rules(code, file)).toContain("no-restricted-imports");
    },
  );
  it.each(["apps/web/lib/server/x.ts", "apps/web/app/api/x/route.ts"])(
    "allows them on the server: %s",
    async (file) => {
      for (const code of imports) expect(await rules(code, file)).toEqual([]);
    },
  );
});

describe("dynamic import of the OpenAI SDK (Task 0 review M3)", () => {
  it.each([
    "apps/web/components/x.tsx",
    "apps/web/lib/server/x.ts",
    "apps/agent/src/x.ts",
    "packages/db/src/x.ts",
    "packages/contracts/src/server/x.ts",
    "tests/x.ts",
  ])('bans import("openai") in %s', async (file) => {
    for (const source of ["openai", "openai/helpers/zod"])
      expect(await rules(`export const l = () => import("${source}");`, file)).toContain(
        "no-restricted-syntax",
      );
  });
});
