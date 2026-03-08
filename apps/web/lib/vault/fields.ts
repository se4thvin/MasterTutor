import {
  Alias,
  CreateVaultItemInput,
  ImapConfig,
  OriginInput,
  PinValue,
  parseTotpSeed,
  type VaultSecretField,
} from "@mastertutor/contracts";
import type { InputHTMLAttributes } from "react";
import type { IconName } from "@/lib/ui/vocabulary.ts";

type InputAttrs = InputHTMLAttributes<HTMLInputElement> &
  Record<"data-1p-ignore" | "data-lpignore", string>;

/** Never autofilled from the browser or the user's password manager, never spell-checked. */
const NO_ASSIST = {
  spellCheck: false,
  maxLength: 4_096,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
} as const;

/**
 * Attributes every secret input carries: masked, `new-password` so nothing is offered, no
 * spellcheck (which can send text to a spelling service). Inputs are uncontrolled and never
 * pre-filled.
 */
export const SECRET_INPUT: InputAttrs = {
  ...NO_ASSIST,
  type: "password",
  autoComplete: "new-password",
};

/** A non-secret vault value (the username): visible while typed, but still never autofilled. */
export const PLAIN_VAULT_INPUT: InputAttrs = { ...NO_ASSIST, type: "text", autoComplete: "off" };

export const FIELD_META: Record<
  VaultSecretField,
  { label: string; icon: IconName; secret: boolean }
> = {
  username: { label: "Username", icon: "username", secret: false },
  password: { label: "Password", icon: "password", secret: true },
  totp: { label: "Authenticator code", icon: "totp", secret: true },
  pin: { label: "PIN", icon: "pin", secret: true },
  imap_password: { label: "Email codes", icon: "emailOtp", secret: true },
  passkey: { label: "Passkey", icon: "passkey", secret: true },
};

export function suggestAlias(originInput: string): string {
  const parsed = OriginInput.safeParse(originInput);
  if (!parsed.success) return "";
  const host = new URL(parsed.data).hostname;
  // An IP literal has no name to borrow; a fragment such as "1" would only mislead.
  if (host.startsWith("[") || /^[0-9.]+$/.test(host)) return "";
  const labels = host.split(".").filter((l) => l !== "www");
  const base = labels.length >= 2 ? (labels[labels.length - 2] ?? "") : (labels[0] ?? "");
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+/, "")
    .slice(0, 63);
}

export type FieldToggle = "username" | "password" | "totp" | "pin" | "imap";
export type VaultFormField =
  "label" | "alias" | "origin" | "username" | "password" | "totp" | "pin" | "imap";

export interface VaultForm {
  label: string;
  alias: string;
  origin: string;
  enabled: Record<FieldToggle, boolean>;
  values: { username: string; password: string; totp: string; pin: string; imapPassword: string };
  imap: { host: string; port: string; user: string; senderFilter: string };
}

export const emptyVaultForm = (): VaultForm => ({
  label: "",
  alias: "",
  origin: "",
  enabled: { username: true, password: true, totp: false, pin: false, imap: false },
  values: { username: "", password: "", totp: "", pin: "", imapPassword: "" },
  imap: { host: "", port: "993", user: "", senderFilter: "" },
});

/** Validates the form; values of disabled fields never leave this function. Errors never contain values. */
export function toCreateInput(
  form: VaultForm,
):
  | { ok: true; input: CreateVaultItemInput }
  | { ok: false; errors: Partial<Record<VaultFormField, string>> } {
  const errors: Partial<Record<VaultFormField, string>> = {};
  if (!form.label.trim()) errors.label = "Add a name you'll recognise.";
  if (!Alias.safeParse(form.alias).success) {
    errors.alias = "Use lowercase letters, numbers, “-” or “_”.";
  }
  const origin = OriginInput.safeParse(form.origin);
  if (!origin.success) errors.origin = "Enter a website such as example.com.";
  const secrets: Record<string, string> = {};
  if (form.enabled.username) {
    if (form.values.username) secrets["username"] = form.values.username;
    else errors.username = "Enter the username or email.";
  }
  if (form.enabled.password) {
    if (form.values.password) secrets["password"] = form.values.password;
    else errors.password = "Enter the password.";
  }
  if (form.enabled.totp) {
    // Sent as typed (trimmed): an otpauth:// link keeps its digits, period and algorithm (E3).
    const seed = form.values.totp.trim();
    if (parseTotpSeed(seed)) secrets["totp"] = seed;
    else errors.totp = "Paste the setup key (16–128 characters) or its otpauth:// link.";
  }
  if (form.enabled.pin) {
    if (PinValue.safeParse(form.values.pin).success) secrets["pin"] = form.values.pin;
    else errors.pin = "Use 4–12 digits.";
  }

  let imap = null;
  if (form.enabled.imap) {
    const parsed = ImapConfig.safeParse({
      host: form.imap.host.trim(),
      port: Number(form.imap.port),
      user: form.imap.user.trim(),
      senderFilter: form.imap.senderFilter.trim(),
    });
    if (parsed.success && form.values.imapPassword) {
      imap = parsed.data;
      secrets["imap_password"] = form.values.imapPassword;
    } else {
      errors.imap = "Fill in the mail server, port, user, sender and password.";
    }
  }
  if (Object.keys(errors).length || !origin.success) return { ok: false, errors };
  const parsed = CreateVaultItemInput.safeParse({
    alias: form.alias,
    origin: origin.data,
    label: form.label.trim(),
    secrets,
    imap,
  });
  if (!parsed.success) return { ok: false, errors: contractErrors(parsed.error.issues) };
  return { ok: true, input: parsed.data };
}

const SECRET_FORM_FIELD: Record<string, VaultFormField> = {
  username: "username",
  password: "password",
  totp: "totp",
  pin: "pin",
  imap_password: "imap",
};

/** Maps contract issues to form fields by path; messages come from the issue code, never the value. */
function contractErrors(
  issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey> }>,
): Partial<Record<VaultFormField, string>> {
  const errors: Partial<Record<VaultFormField, string>> = {};
  for (const issue of issues) {
    const [head, sub] = issue.path;
    const field: VaultFormField =
      head === "secrets"
        ? (SECRET_FORM_FIELD[String(sub)] ?? "label")
        : head === "alias" || head === "origin" || head === "imap"
          ? head
          : "label";
    errors[field] ??= issue.code === "too_big" ? "This is too long." : "Check this field.";
  }
  return errors;
}
