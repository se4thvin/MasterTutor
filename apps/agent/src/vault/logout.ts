/** Matches "log out", "logout", "sign out", "sign off" as words; NFKC folds full-width text. */
export const LOGOUT_ACTION = /\b(?:log|sign)[\s-]?(?:out|off)\b/iu;

export function isLogoutLabel(label: string): boolean {
  return LOGOUT_ACTION.test(label.normalize("NFKC").replace(/\p{Cf}/gu, ""));
}
