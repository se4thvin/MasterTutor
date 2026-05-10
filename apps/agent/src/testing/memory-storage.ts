import type { ObjectHead, PutOptions, Storage } from "@mastertutor/storage";

export function createMemoryStorage(): Storage & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  const types = new Map<string, string>();
  return {
    objects,
    bucket: "memory",
    async put(key: string, body: Uint8Array | string, options: PutOptions) {
      objects.set(
        key,
        typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body),
      );
      types.set(key, options.contentType);
    },
    async getBytes(key: string) {
      const value = objects.get(key);
      if (!value) throw new Error(`missing object ${key}`);
      return value;
    },
    async getStream(key: string) {
      const value = objects.get(key);
      if (!value) throw new Error(`missing object ${key}`);
      // A copy: Blob takes only ArrayBuffer-backed views, and the map may hold a shared one.
      return new Blob([new Uint8Array(value)]).stream();
    },
    async head(key: string): Promise<ObjectHead | null> {
      const value = objects.get(key);
      return value
        ? { bytes: value.byteLength, contentType: types.get(key) ?? null, sha256: null }
        : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async presignGet(key: string) {
      return `memory://${key}`;
    },
    async ping() {},
  };
}
