import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import plugin from "./typography-eslint-plugin.ts";

Object.assign(RuleTester, { afterAll, describe, it, itOnly: it.only });

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-raw-font", plugin.rules["no-raw-font"], {
  valid: [
    '<span className="t-foot tabular text-label-2" />',
    "cx('eyebrow', active && 'text-center')",
    "const family = getComputedStyle(el).getPropertyValue('--font-ui')",
    "g.font = `600 14px ${family}`",
    "<p>Interest is computed on the monospace-free system font</p>",
  ],
  invalid: [
    { code: '<code className="font-mono text-label-2" />', errors: 1 },
    { code: "<p className={`md:font-mono ${x}`} />", errors: 1 },
    { code: "cx('font-[Inter]', on && 'font-semibold', 'tracking-tight')", errors: 3 },
    { code: '<p className="text-[13px]" />', errors: 1 },
    { code: '<span className="mono muted" />', errors: 1 },
    { code: '<p style={{ fontFamily: "Georgia" }} />', errors: 1 },
    { code: '<text fontFamily="var(--font-ui)" />', errors: 1 },
    { code: "const s = { letterSpacing: '-0.02em' }", errors: 1 },
    { code: 'g.font = "600 14px -apple-system, Inter, Helvetica, sans-serif"', errors: 1 },
    { code: 'const svg = `<text font-family="monospace">x</text>`', errors: 1 },
  ],
});
