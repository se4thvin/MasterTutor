import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });

async function restricted(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-syntax")
    .map((message) => message.message);
}

describe("ESLint OpenAI data policy (D38)", () => {
  it("bans stateful APIs on OpenAI clients", async () => {
    for (const code of [
      "export const a = (openai: any) => openai.files.list();",
      "export const b = (client: any) => client.vectorStores.create();",
      "export class C { client: any; d() { return this.client.conversations.create(); } }",
      "export const e = (openai: any) => openai.beta.assistants.list();",
    ])
      expect(await restricted(code, "apps/agent/src/probe.ts")).toHaveLength(1);
    expect(
      await restricted(
        "export const f = (openai: any) => openai.batches.list();",
        "apps/web/lib/probe.ts",
      ),
    ).toHaveLength(1);
  });

  it("does not flag DOM and other objects that have a files property", async () => {
    for (const code of [
      "export const a = (input: HTMLInputElement) => input.files;",
      "export const b = (event: DragEvent) => event.dataTransfer?.files;",
      "export const c = (upload: { files: string[] }) => upload.files.length;",
    ]) {
      expect(await restricted(code, "apps/agent/src/probe.ts")).toEqual([]);
      expect(await restricted(code, "apps/web/lib/probe.ts")).toEqual([]);
    }
  });
});
