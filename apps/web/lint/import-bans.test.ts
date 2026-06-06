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
