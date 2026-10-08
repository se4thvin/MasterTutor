import type { Rule } from "eslint";

/** Keys whose literal values are motion timing and must come from lib/motion-tokens.ts. */
const MOTION_KEYS = new Set([
  "stiffness",
  "damping",
  "mass",
  "bounce",
  "duration",
  "visualDuration",
  "ease",
  "easing",
  "delay",
  "restDelta",
  "restSpeed",
]);

/**
 * CSS motion properties as inline-style keys (QA-020): a literal value must be a motion variable
 * from styles/motion.css, or none. The shorthands take none only, as stylelint bans `transition`.
 */
const STYLE_MOTION_LONGHANDS = new Set([
  "transitionDuration",
  "transitionDelay",
  "transitionTimingFunction",
  "animationDuration",
  "animationDelay",
  "animationTimingFunction",
]);
const STYLE_MOTION_SHORTHANDS = new Set(["transition", "animation"]);
const MOTION_VARIABLES = /^var\(--motion-[a-z0-9-]+\)(\s*,\s*var\(--motion-[a-z0-9-]+\))*$/;

interface AnyNode {
  type: string;
  [key: string]: unknown;
}

/** The string a literal style value spells, or null for a number or anything computed. */
function literalText(node: AnyNode): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value.trim();
  if (node.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0)
    return (
      (node.quasis as Array<{ value: { cooked: string | null } }>)[0]?.value.cooked ?? ""
    ).trim();
  if (node.type === "JSXExpressionContainer") return literalText(node.expression as AnyNode);
  return null;
}

function isRawStyleMotion(key: string, value: AnyNode | null | undefined): boolean {
  const longhand = STYLE_MOTION_LONGHANDS.has(key);
  if ((!longhand && !STYLE_MOTION_SHORTHANDS.has(key)) || !value || !isLiteralish(value))
    return false;
  const text = literalText(value);
  if (text === "none") return false;
  return !(longhand && text !== null && MOTION_VARIABLES.test(text));
}

function isLiteralish(node: AnyNode | null | undefined): boolean {
  if (!node) return false;
  switch (node.type) {
    case "Literal":
      return typeof node.value === "number" || typeof node.value === "string";
    case "UnaryExpression":
      return isLiteralish(node.argument as AnyNode);
    case "ArrayExpression": {
      const elements = node.elements as AnyNode[];
      return elements.length > 0 && elements.every(isLiteralish);
    }
    case "TemplateLiteral":
      return (node.expressions as unknown[]).length === 0;
    case "JSXExpressionContainer":
      return isLiteralish(node.expression as AnyNode);
    default:
      return false;
  }
}

const noRawMotion: Rule.RuleModule = {
  meta: {
    type: "problem",
    messages: {
      raw: "Use a token from lib/motion-tokens.ts instead of a raw '{{key}}' value.",
      rawStyle:
        "Inline '{{key}}' takes a --motion-* variable from styles/motion.css (or none), never a raw time or curve.",
    },
    schema: [],
  },
  create(context) {
    const check = (key: string, value: AnyNode | null | undefined, node: Rule.Node) => {
      if (MOTION_KEYS.has(key) && isLiteralish(value))
        context.report({ node, messageId: "raw", data: { key } });
      else if (isRawStyleMotion(key, value))
        context.report({ node, messageId: "rawStyle", data: { key } });
    };
    return {
      Property(node) {
        if (node.computed) return;
        const key =
          node.key.type === "Identifier"
            ? node.key.name
            : node.key.type === "Literal"
              ? String(node.key.value)
              : null;
        if (key) check(key, node.value as unknown as AnyNode, node);
      },
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as { name: AnyNode; value: AnyNode | null };
        if (attr.name.type !== "JSXIdentifier") return;
        check(String(attr.name.name), attr.value, node);
      },
    } as Rule.RuleListener;
  },
};

/** Tailwind tokens that would bypass the motion tokens. */
const BANNED_CLASS_PATTERNS: RegExp[] = [
  /^transition$/,
  /^transition-(all|colors|shadow|\[.*\])$/,
  /^duration-(\d|\[)/,
  /^ease-(linear|in-out|\[.*\])$/,
  /^delay-(\d|\[)/,
  /^animate-/,
];
const BANNED_ARBITRARY = [/\[(transition|animation)[^\]]*\]/, /\[[^\]]*\d(?:ms|s)\b[^\]]*\]/];

function badTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      if (BANNED_ARBITRARY.some((re) => re.test(token))) return true;
      const base = token.startsWith("[") ? token : (token.split(":").pop() ?? token);
      return BANNED_CLASS_PATTERNS.some((re) => re.test(base));
    });
}

const noRawMotionClasses: Rule.RuleModule = {
  meta: {
    type: "problem",
    messages: {
      raw: "Class '{{token}}' bypasses motion tokens; use transition-transform/opacity with duration-(--motion-dur-*) and ease-*.",
    },
    schema: [],
  },
  create(context) {
    const report = (node: Rule.Node, text: string) => {
      for (const token of badTokens(text))
        context.report({ node, messageId: "raw", data: { token } });
    };
    const visit = (node: AnyNode | null | undefined, reportNode: Rule.Node) => {
      if (!node) return;
      if (node.type === "Literal" && typeof node.value === "string") report(reportNode, node.value);
      if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis as Array<{ value: { cooked: string | null } }>) {
          report(reportNode, quasi.value.cooked ?? "");
        }
      }
      if (node.type === "JSXExpressionContainer") visit(node.expression as AnyNode, reportNode);
      if (node.type === "LogicalExpression") visit(node.right as AnyNode, reportNode);
      if (node.type === "ConditionalExpression") {
        visit(node.consequent as AnyNode, reportNode);
        visit(node.alternate as AnyNode, reportNode);
      }
    };
    return {
      JSXAttribute(node: Rule.Node) {
        const attr = node as unknown as { name: AnyNode; value: AnyNode | null };
        if (attr.name.type === "JSXIdentifier" && attr.name.name === "className")
          visit(attr.value, node);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "cx") {
          for (const arg of node.arguments) visit(arg as unknown as AnyNode, node);
        }
      },
    } as Rule.RuleListener;
  },
};

const plugin = {
  rules: { "no-raw-motion": noRawMotion, "no-raw-motion-classes": noRawMotionClasses },
};
export default plugin;
