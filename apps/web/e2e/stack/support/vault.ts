import { VaultAuditView, VaultItemView } from "@mastertutor/contracts";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { rpcOk } from "./rpc.ts";

export interface SignInForm {
  alias: string;
  website: string;
  name: string;
  username: string;
  password: string;
  totpSeed?: string;
  pin?: string;
  imap?: { server: string; port: number; user: string; from: string; password: string };
}

/** D34: credentials enter only through the Vault UI, typed as a person would. */
export async function addSignIn(page: Page, item: SignInForm): Promise<void> {
  await page.goto("/vault");
  await page.getByRole("button", { name: "Add sign-in" }).click();
  const sheet = page.getByRole("dialog", { name: "Add sign-in" });
  await sheet.getByLabel("Website").fill(item.website);
  await sheet.getByLabel("Website").blur();
  await sheet.getByLabel("Name", { exact: true }).fill(item.name);
  await sheet.getByLabel("Alias").fill(item.alias);
  await sheet.getByLabel("Username or email").fill(item.username);
  await sheet.getByLabel("Password", { exact: true }).last().fill(item.password);
  if (item.totpSeed) {
    await sheet.getByRole("checkbox", { name: "Authenticator (TOTP)" }).check();
    await sheet.getByLabel("Authenticator setup key").fill(item.totpSeed);
  }
  if (item.pin) {
    await sheet.getByRole("checkbox", { name: "PIN", exact: true }).check();
    await sheet.getByLabel("PIN", { exact: true }).last().fill(item.pin);
  }
  if (item.imap) {
    await sheet.getByRole("checkbox", { name: "Email codes (IMAP)" }).check();
    await sheet.getByLabel("Mail server").fill(item.imap.server);
    await sheet.getByLabel("Port").fill(String(item.imap.port));
    await sheet.getByLabel("Mail user").fill(item.imap.user);
    await sheet.getByLabel("Codes come from").fill(item.imap.from);
    await sheet.getByLabel("Mail password").fill(item.imap.password);
  }
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
}

export async function listSignIns(request: APIRequestContext): Promise<VaultItemView[]> {
  const page = await rpcOk<{ items: unknown }>(request, "vault/list", {});
  return VaultItemView.array().parse(page.items);
}

/** Deleting needs no secret, so a re-run on a kept stack clears its own aliases by API. */
export async function removeSignIn(request: APIRequestContext, alias: string): Promise<void> {
  for (const item of await listSignIns(request)) {
    if (item.alias === alias) await rpcOk(request, "vault/delete", { itemId: item.id });
  }
}

export async function auditFor(
  request: APIRequestContext,
  runId: string,
): Promise<VaultAuditView[]> {
  const page = await rpcOk<{ items: unknown }>(request, "vault/audit", {
    limit: 100,
    cursor: null,
  });
  return VaultAuditView.array()
    .parse(page.items)
    .filter((row) => row.runId === runId);
}
