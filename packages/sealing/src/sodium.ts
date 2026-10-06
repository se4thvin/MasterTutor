import sodium from "libsodium-wrappers";

/** libsodium loads its WebAssembly once; every caller awaits readiness first. */
export async function getSodium(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}
