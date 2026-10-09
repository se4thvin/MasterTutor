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

  it("bans importing openai from apps/web too", async () => {
    for (const filePath of [
      "apps/web/lib/probe.ts",
      "apps/web/components/ui/icons.ts",
      "apps/web/components/mascot/probe.tsx",
    ]) {
      const [result] = await eslint.lintText(
        'import OpenAI from "openai";\nexport default OpenAI;\n',
        {
          filePath,
        },
      );
      expect(
        (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports"),
        filePath,
      ).toHaveLength(1);
    }
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

async function ruleMessages(code: string, filePath: string, ruleId: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === ruleId).map((m) => m.message);
}

describe("ESLint fixture-API boundary (P7-14, §3.1)", () => {
  const staticImport =
    'import { FIXTURE_AUTH_COOKIE } from "@/lib/fixtures/cookies.ts";\nexport default FIXTURE_AUTH_COOKIE;\n';
  const relativeImport =
    'import { FIXTURE_AUTH_COOKIE } from "../fixtures/cookies.ts";\nexport default FIXTURE_AUTH_COOKIE;\n';
  const dynamicImport = 'export const load = () => import("@/lib/fixtures/router.ts");\n';

  it("bans fixture imports, static, relative or dynamic, from runtime web code", async () => {
    for (const filePath of [
      "apps/web/components/run/probe.tsx",
      "apps/web/lib/server/probe.ts",
      "apps/web/app/(app)/probe/page.tsx",
      "apps/web/components/ui/icons.ts",
    ]) {
      expect(
        await ruleMessages(staticImport, filePath, "no-restricted-imports"),
        filePath,
      ).toHaveLength(1);
      expect(
        await ruleMessages(relativeImport, filePath, "no-restricted-imports"),
        filePath,
      ).toHaveLength(1);
      expect(
        await ruleMessages(dynamicImport, filePath, "no-restricted-syntax"),
        filePath,
      ).toHaveLength(1);
    }
  });

  it("allows the fixture module, its gated entry points, tests and the Playwright suites", async () => {
    for (const filePath of [
      "apps/web/lib/fixtures/router.ts",
      "apps/web/app/api/rpc/[[...rest]]/route.ts",
      "apps/web/app/api/assets/[assetId]/route.ts",
      "apps/web/lib/server/viewer.ts",
      "apps/web/components/run/model/run-model.test.ts",
      "apps/web/e2e/run-states.spec.ts",
      "apps/web/playwright.stack.config.ts",
    ]) {
      expect(await ruleMessages(staticImport, filePath, "no-restricted-imports"), filePath).toEqual(
        [],
      );
      expect(await ruleMessages(dynamicImport, filePath, "no-restricted-syntax"), filePath).toEqual(
        [],
      );
    }
  });
});
