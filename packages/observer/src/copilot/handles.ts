import { Uuid } from "@mastertutor/contracts";
import { z } from "zod";

export const RunHandle = z.string().regex(/^R[1-9][0-9]{0,3}$/);
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Run UUIDs ↔ thread-local handles (R1, R2…): the model never sees or writes a UUID (spec §7.5). */
export class HandleMap {
  readonly #byHandle = new Map<string, string>();
  readonly #byRun = new Map<string, string>();
  #next = 1;

  constructor(entries: Record<string, string> = {}) {
    for (const [handle, runId] of Object.entries(entries)) {
      RunHandle.parse(handle);
      const id = Uuid.parse(runId).toLowerCase();
      if (this.#byRun.has(id)) throw new Error("Duplicate run handle mapping");
      this.#byHandle.set(handle, id);
      this.#byRun.set(id, handle);
      this.#next = Math.max(this.#next, Number(handle.slice(1)) + 1);
    }
  }

  handleOf(runId: string): string {
    const id = Uuid.parse(runId).toLowerCase();
    const existing = this.#byRun.get(id);
    if (existing) return existing;
    const handle = RunHandle.parse(`R${this.#next++}`);
    this.#byHandle.set(handle, id);
    this.#byRun.set(id, handle);
    return handle;
  }

  runIdOf(handle: string): string | null {
    return this.#byHandle.get(handle) ?? null;
  }

  replaceUuids(text: string): string {
    return text.replace(UUID, (uuid) => this.handleOf(uuid));
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.#byHandle);
  }
}
