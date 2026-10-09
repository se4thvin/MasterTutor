/**
 * The light --label and --bg tokens (styles/tokens.css; app-mark-colors.test.ts keeps them equal).
 * The Home Screen icon and the manifest are drawn without our CSS, so they cannot read the tokens.
 */
export const APP_MARK_COLORS = { tile: "#1d1d1f", glyph: "#fafafa" } as const;
