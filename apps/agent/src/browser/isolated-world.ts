import type { CDPSession } from "playwright-core";
import { PAGE_HELPERS_SOURCE, type PageHelpers } from "./page-helpers.ts";

export type PageFunction<A, R> = (arg: A, h: PageHelpers) => R | Promise<R>;

const WORLD_NAME = "mastertutor";

export interface WorldOptions {
  /** The CDP world name. Owners keep separate worlds (the vault's, capture's library globals). */
  name?: string;
  /** Source run once in every new execution context of this world, before its first use. */
  prelude?: () => Promise<string>;
}

export class PageScriptError extends Error {
  constructor(message: string) {
    super(`page script failed: ${message}`);
    this.name = "PageScriptError";
  }
}

/** Builds `(() => { helpers; return (fn)(arg, h); })()` so helpers resolve lexically. */
export function pageExpression<A, R>(fn: PageFunction<A, R>, arg: A): string {
  return `(() => {\n${PAGE_HELPERS_SOURCE}\nconst h = { isSecretField, describeTarget };\nreturn (${fn.toString()})(${JSON.stringify(arg ?? null)}, h);\n})()`;
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
  readonly #worldName: string;
  readonly #prelude: (() => Promise<string>) | null;
  readonly #contexts = new Map<string, { id: number; document: string | undefined }>();
  #mainFrameId: string | null = null;

  /** `name` separates owners: the vault keeps its own world apart from B1's page helpers. */
  constructor(cdp: CDPSession, options: WorldOptions = {}) {
    this.#cdp = cdp;
    this.#worldName = options.name ?? WORLD_NAME;
    this.#prelude = options.prelude ?? null;
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

  /**
   * The world's context in `frameId`. With `document` (the frame's CDP loaderId) a cached
   * context is reused only for that same document, so a navigation is never mistaken for an
   * unreachable node and vice versa (N1).
   */
  async #contextId(frameId: string, fresh: boolean, document?: string): Promise<number> {
    const cached = this.#contexts.get(frameId);
    if (cached !== undefined && !fresh && (document === undefined || cached.document === document))
      return cached.id;
    const { executionContextId } = await this.#cdp.send("Page.createIsolatedWorld", {
      frameId,
      worldName: this.#worldName,
      grantUniveralAccess: false,
    });
    if (this.#prelude) {
      const result = await this.#cdp.send("Runtime.evaluate", {
        expression: await this.#prelude(),
        contextId: executionContextId,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new PageScriptError(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      }
    }
    this.#contexts.set(frameId, { id: executionContextId, document });
    return executionContextId;
  }

  async #withContext<T>(
    frameId: string | undefined,
    work: (contextId: number) => Promise<T>,
    document?: string,
  ): Promise<T> {
    const id = frameId ?? (await this.mainFrameId());
    try {
      return await work(await this.#contextId(id, false, document));
    } catch (error) {
      if (!isStaleContext(error)) throw error;
      return work(await this.#contextId(id, true, document));
    }
  }

  /**
   * Runs `work` with this world's execution context in `frameId` (cached per frame; a stale one
   * is recreated once). For callers that bind their own CDP calls to the context.
   */
  inContext<T>(
    frameId: string,
    work: (contextId: number) => Promise<T>,
    document?: string,
  ): Promise<T> {
    return this.#withContext(frameId, work, document);
  }

  /** `inContext` for the main frame by default: CDP work that needs this world's context id. */
  inWorld<T>(work: (contextId: number) => Promise<T>, frameId?: string): Promise<T> {
    return this.#withContext(frameId, work);
  }

  /** Calls a self-contained page function with JSON arguments; no helper prelude is injected. */
  async call<A extends unknown[], R>(
    fn: (...args: A) => R,
    args: A,
    frameId?: string,
  ): Promise<Awaited<R>> {
    const value = await this.#withContext(frameId, async (contextId): Promise<unknown> => {
      const result = await this.#cdp.send("Runtime.callFunctionOn", {
        functionDeclaration: fn.toString(),
        executionContextId: contextId,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new PageScriptError(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      }
      return result.result.value;
    });
    return value as Awaited<R>;
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

  /**
   * Calls `functionDeclaration` with `this` bound to a DOM node (by backend id) in our world, so it
   * can compare the node with elements our scripts kept there; returns its value.
   */
  async callOnNode<R>(
    backendNodeId: number,
    functionDeclaration: string,
    arg: unknown,
    frameId?: string,
  ): Promise<R> {
    return this.#withContext(frameId, async (executionContextId) => {
      const { object } = await this.#cdp.send("DOM.resolveNode", {
        backendNodeId,
        executionContextId,
      });
      if (!object.objectId) throw new PageScriptError("node not found");
      const result = await this.#cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration,
        arguments: [{ value: arg }],
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new PageScriptError(result.exceptionDetails.text);
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
