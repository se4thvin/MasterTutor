import type { IsolatedWorlds } from "../browser/isolated-world.ts";

interface DomNode {
  backendNodeId: number;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  shadowRootType?: string;
  contentDocument?: DomNode;
}

/** Closed shadow roots are invisible to page JS; CDP pierces them and hands them to the capture world (spec §7.2). */
export async function registerClosedShadowRoots(
  worlds: IsolatedWorlds,
  frameId?: string,
): Promise<number> {
  const cdp = worlds.cdp;
  const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as unknown as {
    root: DomNode;
  };
  const pairs: { host: number; shadow: number }[] = [];
  const visit = (node: DomNode) => {
    for (const shadow of node.shadowRoots ?? []) {
      if (shadow.shadowRootType === "closed")
        pairs.push({ host: node.backendNodeId, shadow: shadow.backendNodeId });
      visit(shadow);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  const objectGroup = "mt-shadow";
  let registered = 0;
  await worlds.inWorld(async (executionContextId) => {
    try {
      for (const pair of pairs) {
        try {
          const host = await cdp.send("DOM.resolveNode", {
            backendNodeId: pair.host,
            executionContextId,
            objectGroup,
          });
          const shadow = await cdp.send("DOM.resolveNode", {
            backendNodeId: pair.shadow,
            executionContextId,
            objectGroup,
          });
          if (!host.object.objectId || !shadow.object.objectId) continue;
          await cdp.send("Runtime.callFunctionOn", {
            objectId: host.object.objectId,
            functionDeclaration:
              "function (root) { (globalThis.__mtClosedRoots ??= new WeakMap()).set(this, root); }",
            arguments: [{ objectId: shadow.object.objectId }],
          });
          registered++;
        } catch {
          // A root in another frame's document belongs to that frame's context: skipped here.
        }
      }
    } finally {
      await cdp.send("Runtime.releaseObjectGroup", { objectGroup }).catch(() => undefined);
    }
  }, frameId);
  return registered;
}
