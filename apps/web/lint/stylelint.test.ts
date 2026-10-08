import stylelint from "stylelint";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- the config is plain .mjs without type declarations
import config from "../../../stylelint.config.mjs";

async function problems(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({ code, config, codeFilename: "apps/web/styles/x.css" });
  return (results[0]?.warnings ?? []).map((w) => w.rule);
}

describe("stylelint motion rules", () => {
  it("accepts token-driven transform/opacity motion", async () => {
    expect(
      await problems(`.a { transition-property: transform, opacity; transition-duration: var(--motion-dur-micro);
        transition-timing-function: var(--motion-ease-out); }
        @keyframes k { from { opacity: 0; transform: translateY(1rem); } to { opacity: 1; } }`),
    ).toEqual([]);
  });

  // The one compositor-only check for CSS (D28): it parses real CSS, so a last declaration
  // without a trailing semicolon is still seen (qa-tooling-review M1, QA-038).
  it.each([
    [
      "a keyframe's last declaration without a semicolon",
      "@keyframes k { from { opacity: 0; width: 1px } }",
    ],
    ["a filter keyframe", "@keyframes k { to { filter: blur(4px) } }"],
    ["transition-property: all", ".a { transition-property: all; }"],
    ["a filter transition", ".a { transition-property: opacity, backdrop-filter; }"],
  ])("rejects %s", async (_, code) => {
    expect(await problems(code)).not.toEqual([]);
  });

  it("rejects raw times, curves, shorthands and layout animation", async () => {
    const rules = await problems(`.a { transition: background 200ms ease; }
      .b { transition-property: width; animation-timing-function: cubic-bezier(.2,.8,.2,1); }
      .c { transition-timing-function: ease-in-out; }
      @keyframes k { from { height: 0; } }`);
    expect(rules).toEqual(
      expect.arrayContaining([
        "property-disallowed-list",
        "unit-disallowed-list",
        "declaration-property-value-allowed-list",
        "function-disallowed-list",
        "declaration-property-value-disallowed-list",
        "rule-selector-property-disallowed-list",
      ]),
    );
  });

  it("rejects step-start and step-end timing keywords (QA-021)", async () => {
    for (const css of [
      ".a { transition-timing-function: step-end; }",
      ".a { animation-timing-function: step-start; }",
      ".a { animation: k var(--motion-dur-micro) step-end; }",
    ])
      expect(await problems(css), css).toEqual(["declaration-property-value-disallowed-list"]);
  });
});
