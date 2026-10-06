import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import plugin from "./motion-eslint-plugin.ts";

Object.assign(RuleTester, { afterAll, describe, it, itOnly: it.only });

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-raw-motion", plugin.rules["no-raw-motion"], {
  valid: [
    "animate(x, 1, transitions.spring)",
    "const t = { duration: durations.micro / 1000 }",
    "const s = { name: 'x', delay: someValue }",
    "<Toast duration={durations.toast} />",
  ],
  invalid: [
    { code: "animate(x, 1, { stiffness: 400, damping: 30 })", errors: 2 },
    { code: "const t = { duration: 0.2, ease: [0.16, 1, 0.3, 1] }", errors: 2 },
    { code: "el.animate(k, { easing: 'linear' })", errors: 1 },
    { code: "<Toast duration={4000} />", errors: 1 },
  ],
});

tester.run("no-raw-motion-classes", plugin.rules["no-raw-motion-classes"], {
  valid: [
    '<div className="transition-transform duration-(--motion-dur-micro) ease-out" />',
    "cx('btn', active && 'scale-96')",
  ],
  invalid: [
    { code: '<div className="transition duration-200" />', errors: 2 },
    { code: '<div className="transition-colors ease-in-out" />', errors: 2 },
    { code: "<div className={`[transition:opacity_160ms_ease] ${x}`} />", errors: 1 },
    { code: "cx('animate-spin', 'delay-150')", errors: 2 },
  ],
});
