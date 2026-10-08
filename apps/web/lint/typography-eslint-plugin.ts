import type { Rule } from "eslint";

/**
 * One typeface in component code (spec §11.1). Type is styled in CSS through the tokens, which
 * stylelint's mastertutor/type-tokens guards; here we ban what would bypass them: Tailwind font
 * utilities (font-mono above all), inline font styles and font-family stacks spelled in strings.
 * The old `mono` class is banned too. SF Mono's only home is the note code blocks in styles/note.css, so no class here may ask for it.
 */
const BANNED_CLASS =
  /^(mono|font-(mono|sans|serif|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[.*\]|\(.*\))|tracking-.+|text-\[\d.*\]|text-\(length:.*\))$/;
const FONT_KEYS = new Set(["font", "fontFamily", "fontSize", "fontWeight", "letterSpacing"]);
/** A font stack spelled out: canvas `ctx.font`, SVG text or a style string. */
const FONT_STACK =
  /(^|[\s,"'(])(-apple-system|BlinkMacSystemFont|system-ui|ui-monospace|ui-sans-serif|monospace|sans-serif|Inter|Helvetica|Arial|Menlo|Geist(\s+Mono)?|SF (Pro|Mono)[\w ]*)(?=$|[\s,"');])/;

interface AnyNode {
  type: string;
  [key: string]: unknown;
}

function strings(node: AnyNode | null | undefined): string[] {
  if (!node) return [];
  if (node.type === "Literal" && typeof node.value === "string") return [node.value];
  if (node.type === "TemplateLiteral")
    return (node.quasis as Array<{ value: { cooked: string | null } }>).map(
      (q) => q.value.cooked ?? "",
    );
  if (node.type === "JSXExpressionContainer") return strings(node.expression as AnyNode);
  if (node.type === "LogicalExpression") return strings(node.right as AnyNode);
  if (node.type === "ConditionalExpression")
    return [...strings(node.consequent as AnyNode), ...strings(node.alternate as AnyNode)];
  return [];
}

const keyName = (key: AnyNode): string | null =>
  key.type === "Identifier" ? String(key.name) : key.type === "Literal" ? String(key.value) : null;

const noRawFont: Rule.RuleModule = {
  meta: {
    type: "problem",
    messages: {
      cls: "Class '{{token}}' bypasses the type tokens; style text in CSS with var(--font-ui) and var(--text-*).",
      style:
        "Inline '{{key}}' bypasses the type tokens; use a CSS class that reads var(--font-ui).",
      stack:
        "A font stack in code; read the --font-ui token instead (getComputedStyle(…).getPropertyValue).",
    },
    schema: [],
  },
  create(context) {
    const classes = (node: Rule.Node, value: AnyNode | null | undefined) => {
      for (const text of strings(value))
        for (const token of text.split(/\s+/).filter(Boolean))
          if (BANNED_CLASS.test(token.split(":").pop() ?? token))
            context.report({ node, messageId: "cls", data: { token } });
    };
    return {
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as { name: AnyNode; value: AnyNode | null };
        if (attr.name.type !== "JSXIdentifier") return;
        const name = String(attr.name.name);
        if (name === "className") classes(node, attr.value);
        else if (FONT_KEYS.has(name) || name === "font-family")
          context.report({ node, messageId: "style", data: { key: name } });
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "cx")
          for (const arg of node.arguments) classes(node, arg as unknown as AnyNode);
      },
      Property(node) {
        const key = node.computed ? null : keyName(node.key as unknown as AnyNode);
        if (key && FONT_KEYS.has(key) && strings(node.value as unknown as AnyNode).length > 0)
          context.report({ node, messageId: "style", data: { key } });
      },
      "Literal, TemplateElement"(node: Rule.Node) {
        const text =
          node.type === "Literal"
            ? typeof node.value === "string"
              ? node.value
              : ""
            : ((node as unknown as { value: { cooked: string | null } }).value.cooked ?? "");
        if (FONT_STACK.test(text)) context.report({ node, messageId: "stack" });
      },
    } as Rule.RuleListener;
  },
};

const plugin = { rules: { "no-raw-font": noRawFont } };
export default plugin;
