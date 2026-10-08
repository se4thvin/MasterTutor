import stylelint from "stylelint";

/**
 * One typeface, one type scale (spec §11.1). Every text declaration reads styles/tokens.css:
 * the family is var(--font-ui) (SF Pro through the system stack), sizes are var(--text-*),
 * weights var(--weight-*) and tracking var(--tracking-*). SF Mono (var(--font-code)) is allowed
 * only on the selectors listed in the `codeSelectors` option: the code blocks in notes.
 */
const ruleName = "mastertutor/type-tokens";
const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (prop: string, value: string, want: string) =>
    `"${prop}: ${value}" bypasses the type tokens; use ${want} (styles/tokens.css)`,
});

const FAMILY = "var(--font-ui)";
const SIZE = String.raw`var\(--text-[a-z0-9-]+\)`;
const WEIGHT = String.raw`var\(--weight-[a-z]+\)`;
const LINE_HEIGHT = String.raw`(\s*/\s*[0-9.]+(rem)?)?`;
const FONT_SHORTHAND = new RegExp(
  String.raw`^(italic\s+)?(${WEIGHT}\s+)?${SIZE}${LINE_HEIGHT}\s+var\(--font-(ui|code)\)$`,
);
const ALLOWED: Record<string, { test: RegExp; want: string }> = {
  "font-size": { test: new RegExp(`^(${SIZE}|inherit)$`), want: "var(--text-*)" },
  "font-weight": { test: new RegExp(`^(${WEIGHT}|inherit)$`), want: "var(--weight-*)" },
  "letter-spacing": {
    test: /^(var\(--tracking-[a-z]+\)|0|inherit|normal)$/,
    want: "var(--tracking-*) or 0",
  },
  "font-family": { test: /^(var\(--font-(ui|code)\)|inherit)$/, want: FAMILY },
  font: {
    test: new RegExp(`${FONT_SHORTHAND.source}|^inherit$`),
    want: `the tokens and ${FAMILY}`,
  },
};

/** The selector a nested rule resolves to: `.prose { & pre {} }` gives ".prose pre". */
interface CssNode {
  type: string;
  parent?: CssNode | undefined;
  selector?: string;
}
function resolvedSelector(node: CssNode | undefined): string {
  const chain: string[] = [];
  for (let n = node; n; n = n.parent) if (n.type === "rule") chain.unshift(n.selector ?? "");
  return chain.reduce(
    (outer, inner) =>
      inner.includes("&") ? inner.replaceAll("&", outer) : `${outer} ${inner}`.trim(),
    "",
  );
}

interface Options {
  codeSelectors?: string[];
}

const rule = (primary: boolean, options: Options = {}): ReturnType<stylelint.Rule> => {
  return (root, result) => {
    if (!primary) return;
    const codeSelectors = new Set(options.codeSelectors ?? []);
    root.walkDecls((decl) => {
      const value = decl.value.trim();
      const isCode = codeSelectors.has(resolvedSelector(decl.parent as CssNode | undefined));
      const allowed = ALLOWED[decl.prop.toLowerCase()];
      const want =
        value.includes("--font-code") && !isCode
          ? `${FAMILY}; SF Mono is for note code blocks only`
          : allowed && !allowed.test.test(value)
            ? allowed.want
            : null;
      if (want)
        stylelint.utils.report({
          ruleName,
          result,
          node: decl,
          message: messages.rejected(decl.prop, decl.value, want),
        });
    });
  };
};
rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { url: "docs/superpowers/specs/2026-10-05-agentic-notes-design.md#111-tokens" };

export default stylelint.createPlugin(ruleName, rule as unknown as stylelint.Rule);
