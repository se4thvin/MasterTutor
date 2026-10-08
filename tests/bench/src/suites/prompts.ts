import { READ_PAGE_MAX_ELEMENTS as N } from "@mastertutor/contracts";

// Generic prompt pieces shared by every suite (one source). They name no site: a consent banner is
// dismissed generically (P10b-6) and the credential fields are named explicitly (P10b-18, P10a-8).
export const CREDENTIAL_HINT = {
  computer_use:
    'To fill a credential, click the field first, then call fill_credential with target "focused".',
  browser_use:
    "Use read_page to find elements and their refs; pass the ref as the fill_credential target.",
} as const;

export function signInInstruction(signInUrl: string, alias: string): string {
  return (
    `Sign in at ${signInUrl}. If a cookie or consent banner covers the page, accept it first. ` +
    `Use fill_credential with vault alias "${alias}": field "username" for the email box, then field "password". ` +
    "Never type credentials yourself. Submit the sign-in form."
  );
}

/**
 * The read-only grading run of a discovered-readings benchmark (run 1): it finds the readings and
 * their sections itself, moving only through the address bar, which the grader counts as navigation.
 */
export function discoveryInstruction(indexUrl: string, readings: readonly number[]): string {
  return (
    `Open ${indexUrl} by typing it in the address bar (CTRL+L, the URL, ENTER) and call read_page with mode ` +
    `"interactive". Find reading assignments ${readings.join(", ")} there; if they are listed on another page ` +
    'linked from it, open that page the same way and call read_page with mode "interactive". For each reading, ' +
    `open its page by typing ` +
    'its link\'s URL in the address bar and call read_page with mode "interactive"; then open each of its sections ' +
    'the same way, scroll to the bottom once, and call read_page with mode "text" and then "interactive". ' +
    "Every listing must be read whole: when an interactive result's total is larger than the elements it lists, " +
    `call read_page again with offset 0, ${N}, ${2 * N}, … until all are listed; when a chapter or group is ` +
    "[collapsed], expand it by clicking it, then call read_page again. Apart from expanding, never click, type " +
    "or press keys on these pages: use only the address bar. Then finish."
  );
}
