import type { CDPSession } from "playwright-core";
import { PAGE_HELPERS_SOURCE, type PageHelpers } from "./page-helpers.ts";

export type PageFunction<A, R> = (arg: A, h: PageHelpers) => R | Promise<R>;

const WORLD_NAME = "mastertutor";

export class PageScriptError extends Error {
  constructor(message: string) {
    super(`page script failed: ${message}`);
    this.name = "PageScriptError";
  }
}

/** Builds `(() => { helpers; return (fn)(arg, h); })()` so helpers resolve lexically. */
export function pageExpression<A, R>(fn: PageFunction<A, R>, arg: A): string {
  return `(() => {\n${PAGE_HELPERS_SOURCE}\nconst h = { isSecretField, describeTarget, frameIsPlain };\nreturn (${fn.toString()})(${JSON.stringify(arg ?? null)}, h);\n})()`;
}

function isStaleContext(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find context|Execution context was destroyed|uniqueContextId|context with specified id/i.test(
    message,
  );
}

/**
 * Runs our page scripts in a CDP isolated world (spec §6): page scripts cannot see or tamper
 * with them, and they never touch the main world's globals. Element refs live here too.
 */
export class IsolatedWorlds {
  readonly #cdp: CDPSession;
  readonly #contexts = new Map<string, number>();
  #mainFrameId: string | null = null;

  constructor(cdp: CDPSession) {
    this.#cdp = cdp;
  }

  /** The CDP session these worlds live on (for DOM.describeNode / DOM.getBoxModel on handles). */
  get cdp(): CDPSession {
    return this.#cdp;
  }

  async mainFrameId(): Promise<string> {
    if (this.#mainFrameId === null) {
      const { frameTree } = await this.#cdp.send("Page.getFrameTree");
      this.#mainFrameId = frameTree.frame.id;
    }
    return this.#mainFrameId;
  }

  async #contextId(frameId: string, fresh: boolean): Promise<number> {
    const cached = this.#contexts.get(frameId);
    if (cached !== undefined && !fresh) return cached;
    const { executionContextId } = await this.#cdp.send("Page.createIsolatedWorld", {
      frameId,
      worldName: WORLD_NAME,
      grantUniveralAccess: false,
    });
    this.#contexts.set(frameId, executionContextId);
    return executionContextId;
  }

  async #withContext<T>(
    frameId: string | undefined,
    work: (contextId: number) => Promise<T>,
  ): Promise<T> {
    const id = frameId ?? (await this.mainFrameId());
    try {
      return await work(await this.#contextId(id, false));
    } catch (error) {
      if (!isStaleContext(error)) throw error;
      return work(await this.#contextId(id, true));
    }
  }

  async evaluate<A, R>(fn: PageFunction<A, R>, arg: A, frameId?: string): Promise<R> {
    const expression = pageExpression(fn, arg);
    return this.#withContext(frameId, async (contextId) => {
      const result = await this.#cdp.send("Runtime.evaluate", {
        expression,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new PageScriptError(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      }
      return result.result.value as R;
    });
  }

  /** Returns a remote objectId (for DOM.describeNode), or null when the expression yields nothing. */
  async evaluateHandle(expression: string, frameId?: string): Promise<string | null> {
    return this.#withContext(frameId, async (contextId) => {
      const result = await this.#cdp.send("Runtime.evaluate", {
        expression,
        contextId,
        returnByValue: false,
      });
      if (result.exceptionDetails) throw new PageScriptError(result.exceptionDetails.text);
      return result.result.objectId ?? null;
    });
  }
}
