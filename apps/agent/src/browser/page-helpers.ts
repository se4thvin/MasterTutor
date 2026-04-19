/**
 * Helpers that run INSIDE pages (CDP isolated world). They must stay self-contained: no imports,
 * no module constants, only DOM APIs. They are serialized with Function.prototype.toString.
 */
export interface TargetDescription {
  label: string;
  tag: string;
  /**
   * Where the element sits (`tag:nth` steps from the root, `#shadow` across shadow roots). Approvals
   * bind to it, so a same-label element elsewhere (another row's "Delete") is not approved.
   */
  path: string;
  /**
   * The record the element acts on: in the page, the visible text of its nearest record container
   * and of the main area (live regions left out) plus the URL; the browser module replaces it with
   * a sha256 digest before it leaves (R29-3). Approvals bind to it.
   */
  context: string;
  /**
   * The record's visible text (≤ 2 000, so a secret near the card's 240-character cut is still
   * whole when redacted), for the approval card only (run view A3a). Never sent to the model; the
   * loop browser redacts vault secrets from it, then caps it. Absent for opaque frames.
   */
  excerpt?: string;
  /** An embedded page that could not be inspected: activating it always needs approval (R29-1). */
  opaqueFrame?: boolean;
  /**
   * Activating it downloads (a link with a `download` attribute): what and under which suggested
   * name, so the download is approved before any request is sent (spec §9).
   */
  download?: { url: string; filename: string | null };
  isFormSubmit: boolean;
  formKind: "login" | "search" | "other" | null;
  isSecretField: boolean;
  editable: boolean;
  interactive: boolean;
}

/** Password, OTP and PIN inputs: masked in model screenshots and refused for `type` (spec §6, §9). */
export function isSecretField(el: Element): boolean {
  if (el.tagName !== "INPUT") return false;
  const input = el as HTMLInputElement;
  const type = (input.getAttribute("type") ?? "text").toLowerCase();
  if (type === "password") return true;
  const nonText = [
    "hidden",
    "checkbox",
    "radio",
    "submit",
    "button",
    "image",
    "file",
    "reset",
    "range",
    "color",
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
  ];
  if (nonText.includes(type)) return false;
  const autocomplete = (input.getAttribute("autocomplete") ?? "").toLowerCase();
  if (/one-time-code|current-password|new-password/.test(autocomplete)) return true;
  const rawHint = [
    input.name,
    input.id,
    input.getAttribute("aria-label") ?? "",
    input.placeholder,
  ].join(" ");
  // Compound names count: "userPassword", "passwordConfirm", "new_pwd". Long tokens match anywhere;
  // short ones (pin, otp, 2fa...) need a word boundary, where camelCase humps are boundaries too.
  if (/(password|passwd|pwd|passcode|2fa|totp)/i.test(rawHint)) return true;
  const hint = rawHint.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  if (
    /(^|[^a-z])(pin|otp|one[-_ ]?time|mfa|verification[-_ ]?code|security[-_ ]?code)([^a-z]|$)/i.test(
      hint,
    )
  ) {
    return true;
  }
  const inputMode = (input.getAttribute("inputmode") ?? "").toLowerCase();
  return inputMode === "numeric" && input.maxLength > 0 && input.maxLength <= 2;
}

/** What an element is, for approval classification and typing checks. Never returns field values. */
export function describeTarget(el: Element): TargetDescription {
  const INTERACTIVE =
    "a[href], button, input, select, textarea, summary, label, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [onclick], [tabindex]:not([tabindex='-1']), [contenteditable=''], [contenteditable='true']";
  const target = el.closest(INTERACTIVE) ?? el;
  const tag = target.tagName.toLowerCase();
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const type = (target.getAttribute("type") ?? "").toLowerCase();
  const buttonValue =
    tag === "input" && ["button", "submit", "reset"].includes(type)
      ? (target as HTMLInputElement).value
      : "";
  const label =
    clean(target.getAttribute("aria-label")) ||
    clean((target as HTMLElement).innerText) ||
    clean(buttonValue) ||
    clean(target.getAttribute("title")) ||
    clean(target.getAttribute("alt"));
  const form = (target as HTMLInputElement).form ?? target.closest("form");
  let formKind: TargetDescription["formKind"] = null;
  if (form) {
    const inputs = [...form.querySelectorAll("input")];
    if (form.querySelector("input[type=password]")) formKind = "login";
    else if (
      form.getAttribute("role") === "search" ||
      form.querySelector("input[type=search]") ||
      inputs.some((input) => /^(q|query|search|s)$/i.test(input.name))
    ) {
      formKind = "search";
    } else formKind = "other";
  }
  const isFormSubmit =
    Boolean(form) &&
    ((tag === "button" && (type === "" || type === "submit")) ||
      (tag === "input" && (type === "submit" || type === "image")));
  const nonText = [
    "checkbox",
    "radio",
    "submit",
    "button",
    "image",
    "file",
    "reset",
    "range",
    "color",
    "hidden",
  ];
  const editable =
    (tag === "input" && !nonText.includes(type || "text")) ||
    tag === "textarea" ||
    (target as HTMLElement).isContentEditable;
  const steps: string[] = [];
  let node: Element | null = target;
  for (let depth = 0; node && depth < 32; depth++) {
    const name = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      steps.unshift(name);
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
      if (node) steps.unshift("#shadow");
      continue;
    }
    const current: Element = node;
    const same = [...parent.children].filter((child) => child.tagName === current.tagName);
    steps.unshift(same.length > 1 ? `${name}:${same.indexOf(current) + 1}` : name);
    node = parent;
  }
  const LIVE =
    "[aria-live], [role=status], [role=timer], [role=log], [role=marquee], [role=alert], time, script, style, noscript, template";
  // The record the element acts on (R29-3), bounded (N4): the nearest row/record container or
  // landmark, else the body; at most 500 text nodes (2,000 visited) in document order, live regions left out.
  const RECORD =
    "tr, [role=row], li, [role=listitem], article, [role=article], dialog, [role=dialog], fieldset, form, section, [role=region], [aria-selected=true], main, [role=main], nav, [role=navigation], aside, [role=complementary], header, footer";
  const doc = target.ownerDocument;
  const textIn = (scope: Element): string => {
    const parts: string[] = [];
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let visited = 0;
    for (
      let node = walker.nextNode();
      node && parts.length < 500 && visited < 2_000;
      node = walker.nextNode(), visited++
    ) {
      if (node.parentElement?.closest(LIVE)) continue;
      const text = clean(node.textContent);
      if (text) parts.push(text);
    }
    return parts.join(" ").slice(0, 16_000);
  };
  // A container that holds nothing but the element itself (Rails button_to's lone <form>) says
  // nothing about the record: climb to the next record or landmark, else the body (N4).
  const own = clean(target.textContent);
  const body = doc.body ?? doc.documentElement;
  let scope: Element = target.closest(RECORD) ?? body;
  let recordText = textIn(scope);
  for (let climb = 0; climb < 6 && scope !== body && recordText === own; climb++) {
    scope = scope.parentElement?.closest(RECORD) ?? body;
    recordText = textIn(scope);
  }
  const parts = [recordText];
  const downloadLink = target.closest("a[download][href], area[download][href]") as
    HTMLAnchorElement | HTMLAreaElement | null;
  const context = [parts.join(" ").slice(0, 16_000), doc.location?.href ?? ""].join("\n");
  return {
    label: label.slice(0, 200),
    tag,
    path: steps.join(">").slice(0, 1_000),
    context,
    excerpt: recordText.slice(0, 2_000),
    isFormSubmit,
    formKind,
    isSecretField: isSecretField(target),
    editable,
    interactive: target !== el || el.matches(INTERACTIVE),
    ...(downloadLink
      ? {
          download: {
            url: downloadLink.href.slice(0, 4_096),
            filename: downloadLink.getAttribute("download") || null,
          },
        }
      : {}),
  };
}

/** Elements that hold another document. Page scripts receive it as an argument. */
export const FRAME_OWNERS = ["IFRAME", "FRAME", "OBJECT", "EMBED", "FENCEDFRAME", "PORTAL"];

export const PAGE_HELPERS = { isSecretField, describeTarget };
export type PageHelpers = typeof PAGE_HELPERS;
export const PAGE_HELPERS_SOURCE = [isSecretField.toString(), describeTarget.toString()].join("\n");
