"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { errorCode } from "@/lib/api/errors.ts";
import {
  emptyVaultForm,
  suggestAlias,
  toCreateInput,
  type FieldToggle,
  type VaultForm,
  type VaultFormField,
} from "@/lib/vault/fields.ts";

/**
 * Attributes every secret input carries: masked, no autofill from the browser or the user's own
 * password manager, no spellcheck (which can send text to a spelling service). Never pre-filled.
 */
export const SECRET_INPUT: InputHTMLAttributes<HTMLInputElement> &
  Record<"data-1p-ignore" | "data-lpignore", string> = {
  type: "password",
  autoComplete: "new-password",
  spellCheck: false,
  maxLength: 4_096,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
};

const TOGGLES: Array<{ key: FieldToggle; label: string }> = [
  { key: "username", label: "Username" },
  { key: "password", label: "Password" },
  { key: "totp", label: "Authenticator (TOTP)" },
  { key: "pin", label: "PIN" },
  { key: "imap", label: "Email codes (IMAP)" },
];

/**
 * Secret inputs are uncontrolled: a controlled input mirrors its value into the DOM `value`
 * attribute, where serialisers and CSS attribute selectors can read it. Each is named by its
 * VaultForm key, read once from the form at submit, and then wiped.
 */
const SECRET_FIELDS = {
  password: "password",
  totp: "totp",
  pin: "pin",
  imapPassword: "imap",
} as const satisfies Partial<Record<keyof VaultForm["values"], VaultFormField>>;
type SecretKey = keyof typeof SECRET_FIELDS;
const SECRET_KEYS = Object.keys(SECRET_FIELDS) as SecretKey[];

/** Reads every secret input once, then empties them, so the DOM holds no secret after submit. */
function takeSecrets(formEl: HTMLFormElement): Record<SecretKey, string> {
  const data = new FormData(formEl);
  const values = Object.fromEntries(
    SECRET_KEYS.map((key) => [key, String(data.get(key) ?? "")]),
  ) as Record<SecretKey, string>;
  for (const key of SECRET_KEYS) {
    const input = formEl.elements.namedItem(key);
    if (input instanceof HTMLInputElement) input.value = "";
  }
  return values;
}

/** After a failed submit, every secret that was wiped asks to be typed again (unless it has a worse error). */
function reenterErrors(
  secrets: Record<SecretKey, string>,
  errors: Partial<Record<VaultFormField, string>>,
): Partial<Record<VaultFormField, string>> {
  const next = { ...errors };
  for (const key of SECRET_KEYS) if (secrets[key]) next[SECRET_FIELDS[key]] ??= "Enter it again.";
  return next;
}

export function AddSignInSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Mounting only while open discards every value typed previously.
  return open ? <AddSignInForm onClose={() => onOpenChange(false)} /> : null;
}

function AddSignInForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<VaultForm>(emptyVaultForm);
  const [errors, setErrors] = useState<Partial<Record<VaultFormField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [aliasTouched, setAliasTouched] = useState(false);
  const patch = (fn: (f: VaultForm) => VaultForm) => setForm((f) => fn(f));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Secrets are read once and wiped from the inputs before anything else happens.
    const secrets = takeSecrets(event.currentTarget);
    const result = toCreateInput({ ...form, values: { ...form.values, ...secrets } });
    // Field errors are quiet text; this one message is the only thing announced.
    if (!result.ok) {
      setErrors(reenterErrors(secrets, result.errors));
      setFormError("Check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    setPending(true);
    try {
      await api.vault.create(result.input);
      await qc.invalidateQueries({ queryKey: orpc.vault.key() });
      toast({ title: "Saved. Values are sealed.", icon: "sealed" });
      onClose();
    } catch (err) {
      const conflict = errorCode(err) === "CONFLICT";
      setErrors(reenterErrors(secrets, conflict ? { alias: "That alias is already used." } : {}));
      setFormError(conflict ? "Check the highlighted fields." : "Couldn't save. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add sign-in"
      description="The agent will use this by alias. You won't be able to view these values again."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-sign-in" disabled={pending}>
            Save
          </Button>
        </>
      }
    >
      <form id="add-sign-in" className="vform" onSubmit={submit} autoComplete="off" noValidate>
        {formError ? (
          <p className="tf-error" role="alert">
            {formError}
          </p>
        ) : null}
        <TextField
          announceError={false}
          label="Website"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={form.origin}
          error={errors.origin}
          onChange={(e) => patch((f) => ({ ...f, origin: e.target.value }))}
          onBlur={() =>
            !aliasTouched && patch((f) => ({ ...f, alias: suggestAlias(f.origin) || f.alias }))
          }
          hint="The agent may use this sign-in only on this website."
        />
        <TextField
          announceError={false}
          label="Name"
          autoComplete="off"
          value={form.label}
          error={errors.label}
          onChange={(e) => patch((f) => ({ ...f, label: e.target.value }))}
        />
        <TextField
          announceError={false}
          label="Alias"
          autoComplete="off"
          spellCheck={false}
          value={form.alias}
          error={errors.alias}
          onChange={(e) => {
            setAliasTouched(true);
            patch((f) => ({ ...f, alias: e.target.value }));
          }}
          hint="What the agent asks for. Lowercase letters, numbers, “-” or “_”."
        />
        <fieldset className="vform-fields">
          <legend className="tf-label">Sign-in uses</legend>
          {TOGGLES.map((t) => (
            <label key={t.key} className="vform-toggle">
              <input
                type="checkbox"
                checked={form.enabled[t.key]}
                onChange={(e) =>
                  patch((f) => ({ ...f, enabled: { ...f.enabled, [t.key]: e.target.checked } }))
                }
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        {form.enabled.username ? (
          <TextField
            announceError={false}
            label="Username or email"
            autoComplete="off"
            spellCheck={false}
            value={form.values.username}
            error={errors.username}
            onChange={(e) =>
              patch((f) => ({ ...f, values: { ...f.values, username: e.target.value } }))
            }
          />
        ) : null}
        {form.enabled.password ? (
          <TextField
            announceError={false}
            label="Password"
            {...SECRET_INPUT}
            name="password"
            error={errors.password}
          />
        ) : null}
        {form.enabled.totp ? (
          <TextField
            announceError={false}
            label="Authenticator setup key"
            {...SECRET_INPUT}
            name="totp"
            error={errors.totp}
            hint="Paste the key or otpauth:// link shown when you set up two-factor."
          />
        ) : null}
        {form.enabled.pin ? (
          <TextField
            announceError={false}
            label="PIN"
            {...SECRET_INPUT}
            inputMode="numeric"
            name="pin"
            error={errors.pin}
            hint="Filled across split boxes in order."
          />
        ) : null}
        {form.enabled.imap ? (
          <fieldset className="vform-imap">
            <legend className="tf-label">Email codes</legend>
            <TextField
              announceError={false}
              label="Mail server"
              autoComplete="off"
              spellCheck={false}
              value={form.imap.host}
              onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, host: e.target.value } }))}
            />
            <TextField
              announceError={false}
              label="Port"
              inputMode="numeric"
              autoComplete="off"
              value={form.imap.port}
              onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, port: e.target.value } }))}
            />
            <TextField
              announceError={false}
              label="Mail user"
              autoComplete="off"
              spellCheck={false}
              value={form.imap.user}
              onChange={(e) => patch((f) => ({ ...f, imap: { ...f.imap, user: e.target.value } }))}
            />
            <TextField
              announceError={false}
              label="Codes come from"
              autoComplete="off"
              spellCheck={false}
              value={form.imap.senderFilter}
              hint="Sender address, e.g. no-reply@example.com"
              onChange={(e) =>
                patch((f) => ({ ...f, imap: { ...f.imap, senderFilter: e.target.value } }))
              }
            />
            <TextField
              announceError={false}
              label="Mail password"
              {...SECRET_INPUT}
              name="imapPassword"
              error={errors.imap}
            />
          </fieldset>
        ) : null}
        <p className="t-foot vform-note">
          <Icon name="passkey" size="sm" /> Passkeys are added during a run: take over the browser
          and register one on the site.
        </p>
      </form>
    </Sheet>
  );
}
