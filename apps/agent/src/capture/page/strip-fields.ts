import type { PageHelpers } from "../../browser/page-helpers.ts";

/** Identifying attributes of a field the vault filled, read from the live page by CDP. */
export interface FilledFieldIds {
  id: string | null;
  name: string | null;
}

/**
 * Runs in the helper world. Self-contained. Each HTML document's source, parsed into a detached
 * document (nothing runs or loads, the live page is untouched), with the value of every password,
 * OTP and PIN field (`isSecretField`, the masking rule) and every vault-filled field removed.
 * Shadow roots serialized as `<template>` are searched too. Unchanged sources come back as given.
 */
export function pageStripSecretFields(
  arg: { html: string[]; filled: FilledFieldIds[] },
  h: PageHelpers,
): string[] {
  const filled = (el: Element) =>
    arg.filled.some(
      (field) =>
        (field.id !== null && el.getAttribute("id") === field.id) ||
        (field.name !== null && el.getAttribute("name") === field.name),
    );
  return arg.html.map((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    let changed = false;
    const visit = (root: ParentNode) => {
      for (const el of root.querySelectorAll("input, textarea")) {
        if (!h.isSecretField(el) && !filled(el)) continue;
        if (el.tagName === "TEXTAREA") {
          if (el.textContent) {
            el.textContent = "";
            changed = true;
          }
        } else if (el.hasAttribute("value")) {
          el.removeAttribute("value");
          changed = true;
        }
      }
      for (const template of root.querySelectorAll("template"))
        visit((template as HTMLTemplateElement).content);
    };
    visit(doc);
    if (!changed) return source;
    const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "";
    return doctype + doc.documentElement.outerHTML;
  });
}
