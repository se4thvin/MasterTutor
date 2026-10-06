/**
 * Helpers that run INSIDE pages (CDP isolated world). They must stay self-contained: no imports,
 * no module constants, only DOM APIs. They are serialized with Function.prototype.toString.
 */
export interface TargetDescription {
  label: string;
  tag: string;
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
  const hint = [
    input.name,
    input.id,
    input.getAttribute("aria-label") ?? "",
    input.placeholder,
  ].join(" ");
  if (
    /\b(pin|otp|passcode|one[-_ ]?time|2fa|mfa|totp|verification[-_ ]?code|security[-_ ]?code)\b/i.test(
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
  return {
    label: label.slice(0, 200),
    tag,
    isFormSubmit,
    formKind,
    isSecretField: isSecretField(target),
    editable,
    interactive: target !== el || el.matches(INTERACTIVE),
  };
}

export const PAGE_HELPERS = { isSecretField, describeTarget };
export type PageHelpers = typeof PAGE_HELPERS;
export const PAGE_HELPERS_SOURCE = [isSecretField.toString(), describeTarget.toString()].join("\n");
