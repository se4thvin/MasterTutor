import type { VaultSecretField } from "@mastertutor/contracts";

/**
 * What a sealed box belongs to (spec §9 row binding). Opening checks it against the row,
 * so a ciphertext copied into another row, workspace, origin or field never opens.
 */
export type SealBinding =
  | { kind: "secret"; workspaceId: string; alias: string; origin: string; field: VaultSecretField }
  | { kind: "session"; workspaceId: string; alias: string; origin: string }
  | { kind: "otp"; workspaceId: string; runId: string };

/** Fixed field order per kind, so equal bindings always encode to equal strings. */
export function encodeBinding(binding: SealBinding): string {
  switch (binding.kind) {
    case "secret":
      return JSON.stringify([
        "secret",
        binding.workspaceId,
        binding.alias,
        binding.origin,
        binding.field,
      ]);
    case "session":
      return JSON.stringify(["session", binding.workspaceId, binding.alias, binding.origin]);
    case "otp":
      return JSON.stringify(["otp", binding.workspaceId, binding.runId]);
  }
}
