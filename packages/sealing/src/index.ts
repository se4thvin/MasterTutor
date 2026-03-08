// Web-safe entry: sealing only. Opening lives in ./open, which only the agent may import.
export { encodeBinding, type SealBinding } from "./binding.ts";
export {
  MAX_SEALED_VALUE_BYTES,
  SEAL_VERSION,
  SealError,
  VAULT_KEY_BYTES,
  decodeVaultKey,
  sealValue,
  wipe,
  type SealErrorCode,
} from "./seal.ts";
