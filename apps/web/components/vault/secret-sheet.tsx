"use client";

import {
  TYPED_SECRET_FIELDS,
  type TypedSecretField,
  type VaultItemView,
} from "@mastertutor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import {
  FIELD_META,
  PLAIN_VAULT_INPUT,
  SECRET_INPUT,
  isValidPin,
  normalizeTotpSeed,
} from "@/lib/vault/fields.ts";

/** The value to send for a field, or null when it is not valid. Never returns a partial echo. */
function normalize(field: TypedSecretField, value: string): string | null {
  if (field === "totp") return normalizeTotpSeed(value);
  if (field === "pin") return isValidPin(value) ? value : null;
  return value || null;
}

const INVALID: Partial<Record<TypedSecretField, string>> = {
  pin: "Use 4–12 digits.",
  totp: "Paste the setup key or otpauth:// link.",
};

export function SecretSheet({
  item,
  onClose,
}: {
  item: VaultItemView | null;
  onClose: () => void;
}) {
  // Keyed by item and mounted only while open, so typed values are discarded on close.
  return item ? <SecretForm key={item.id} item={item} onClose={onClose} /> : null;
}

function SecretForm({ item, onClose }: { item: VaultItemView; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [field, setField] = useState<TypedSecretField>(
    // Opens on a secret the item has (the username is rarely what needs replacing).
    TYPED_SECRET_FIELDS.find((f) => FIELD_META[f].secret && item.fields.includes(f)) ?? "password",
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const exists = item.fields.includes(field);
  const label = FIELD_META[field].label;

  const refresh = () => qc.invalidateQueries({ queryKey: orpc.vault.key() });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Uncontrolled (a controlled input mirrors its value into the DOM attribute): read once, wipe.
    const input = event.currentTarget.elements.namedItem("value");
    if (!(input instanceof HTMLInputElement)) return;
    const normalized = normalize(field, input.value);
    input.value = "";
    if (!normalized) {
      setError(INVALID[field] ?? "Enter a value.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api.vault.setSecret({ itemId: item.id, field, value: normalized });
      await refresh();
      toast({ title: `${label} ${exists ? "replaced" : "added"}. It's sealed.`, icon: "sealed" });
      onClose();
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    try {
      await api.vault.removeSecret({ itemId: item.id, field });
      await refresh();
      toast({ title: `${label} removed`, icon: "delete" });
      onClose();
    } catch {
      toast({ title: "Couldn't remove the value.", icon: "needsReview", tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        title="Replace or add a value"
        description={`For ${item.alias}. The current value is never shown.`}
        footer={
          <>
            {exists ? (
              <Button
                variant="plain"
                className="mr-auto"
                disabled={pending}
                onClick={() => setConfirm(true)}
              >
                Remove value…
              </Button>
            ) : null}
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="secret-form" disabled={pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="secret-form" className="vform" onSubmit={save} autoComplete="off" noValidate>
          <div className="tf">
            <label htmlFor="secret-field" className="tf-label">
              Field
            </label>
            <select
              id="secret-field"
              className="tf-input"
              value={field}
              onChange={(e) => {
                setField(e.target.value as TypedSecretField);
                setError(null);
              }}
            >
              {TYPED_SECRET_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {FIELD_META[f].label}
                  {item.fields.includes(f) ? " (replace)" : " (add)"}
                </option>
              ))}
            </select>
          </div>
          {/* Keyed on the field: switching fields remounts the input, dropping anything typed. */}
          <TextField
            key={field}
            label="New value"
            name="value"
            {...(FIELD_META[field].secret ? SECRET_INPUT : PLAIN_VAULT_INPUT)}
            inputMode={field === "pin" ? "numeric" : undefined}
            error={error}
          />
        </form>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove the ${label.toLowerCase()}?`}
        description="The agent won't be able to use it until you add it again."
        confirmLabel="Remove Value"
        destructive
        onConfirm={() => void remove()}
      />
    </>
  );
}
