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
