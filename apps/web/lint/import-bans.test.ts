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
