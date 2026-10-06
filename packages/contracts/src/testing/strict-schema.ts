import { z } from "zod";

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
}

/**
 * OpenAI structured outputs and strict function tools need an object root and every
 * property required (nullable is fine, optional is not). Returns the violations found.
 */
export function strictSchemaProblems(schema: z.ZodType): string[] {
  const root = z.toJSONSchema(schema, { io: "input" }) as JsonSchemaNode;
  const problems: string[] = [];
  if (root.type !== "object") problems.push("$ root is not an object");
  walk(root, "$", problems);
  return problems;
}

function walk(node: JsonSchemaNode, path: string, problems: string[]): void {
  if (node.properties) {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties)) {
      if (!required.has(key)) problems.push(`${path}.${key} is optional`);
      walk(child, `${path}.${key}`, problems);
    }
  }
  if (node.items) walk(node.items, `${path}[]`, problems);
  for (const variants of [node.anyOf, node.oneOf, node.allOf]) {
    variants?.forEach((child, index) => walk(child, `${path}|${index}`, problems));
  }
}
