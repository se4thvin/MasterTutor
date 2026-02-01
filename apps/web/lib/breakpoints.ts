/**
 * Width breakpoints in rem, mirrored by --breakpoint-* in app/globals.css (a test keeps them equal).
 * Each is 1px above a QA width: sm > 420, md > 820, lg > 1180 (spec §11.5).
 */
export const BREAKPOINTS_REM = { sm: 26.3125, md: 51.3125, lg: 73.8125 } as const;

export const MEDIA = {
  sm: `(min-width: ${BREAKPOINTS_REM.sm}rem)`,
  md: `(min-width: ${BREAKPOINTS_REM.md}rem)`,
  lg: `(min-width: ${BREAKPOINTS_REM.lg}rem)`,
} as const;
