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
const BITS = "apps/web/components/bits/x.tsx";
const MOTION_DIR = "apps/web/components/motion/x.tsx";
const LAYOUT_FEATURES = "apps/web/components/motion/layout-features.ts";

describe("animation and icon import bans", () => {
  it.each(["gsap", "ogl", "framer-motion", "matter-js", "@react-three/fiber", "@hugeicons/react"])(
    "bans %s everywhere in apps/web, statically and dynamically",
    async (pkg) => {
      for (const file of [WEB, HERO, ICONS, BITS]) {
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

describe("D43 lazy layout-motion boundary", () => {
  it("bans the domMax bundle outside layout-features.ts", async () => {
    const code = `import { domMax } from "motion/react"; export default domMax;`;
    expect(await rules(code, WEB)).toContain("no-restricted-imports");
    expect(await rules(code, BITS)).toContain("no-restricted-imports");
    expect(await rules(code, LAYOUT_FEATURES)).toEqual([]);
  });

  it("still bans the full motion component in layout-features.ts", async () => {
    expect(
      await rules(`import { motion } from "motion/react"; export default motion;`, LAYOUT_FEATURES),
    ).toContain("no-restricted-imports");
  });

  it("reaches layout-features only through import()", async () => {
    expect(
      await rules(`import f from "@/components/motion/layout-features.ts"; export default f;`, WEB),
    ).toContain("no-restricted-imports");
    expect(
      await rules(`import f from "./layout-features.ts"; export default f;`, MOTION_DIR),
    ).toContain("no-restricted-imports");
    expect(
      await rules(`export const l = () => import("./layout-features.ts");`, MOTION_DIR),
    ).toEqual([]);
  });
});

describe("UI library bans reach every package, not only apps/web (QA-019)", () => {
  it.each([
    "apps/agent/src/x.ts",
    "apps/browser-slot/x.ts",
    "packages/contracts/src/x.ts",
    "packages/contracts/src/server/x.ts",
    "packages/db/src/x.ts",
    "tests/x.ts",
    "tests/bench/src/x.ts",
    "scripts/x.ts",
  ])("bans animation, three and icon libraries in %s", async (file) => {
    for (const pkg of ["gsap", "framer-motion", "three", "lucide-react", "@hugeicons/react"]) {
      expect(await rules(`import x from "${pkg}"; export default x;`, file), pkg).toContain(
        "no-restricted-imports",
      );
      expect(await rules(`export const l = () => import("${pkg}");`, file), pkg).toContain(
        "no-restricted-syntax",
      );
    }
  });
});

describe("template-literal dynamic imports are banned like string ones (QA-023)", () => {
  it.each([
    [WEB, "gsap"],
    [WEB, "three"],
    [WEB, "@/lib/fixtures/x"],
    ["apps/web/lib/server/x.ts", "openai"],
    ["apps/agent/src/x.ts", "openai/helpers/zod"],
    ["packages/db/src/x.ts", "gsap"],
  ])("%s: import(`%s`)", async (file, source) => {
    expect(await rules("export const l = () => import(`" + source + "`);", file)).toContain(
      "no-restricted-syntax",
    );
    expect(
      await rules("export const l = (p: string) => import(`" + source + "/${p}`);", file),
    ).toContain("no-restricted-syntax");
  });
  it("still allows a template-literal import of an unbanned module", async () => {
    expect(
      await rules("export const l = () => import(`./layout-features.ts`);", MOTION_DIR),
    ).toEqual([]);
  });
});
