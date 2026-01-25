const FRAME_PATTERNS = [
  /\/recaptcha\/(?:api2|enterprise)\/(?:anchor|bframe)\b/,
  /^https?:\/\/(?:[\w-]+\.)*hcaptcha\.com\//,
  /\/cdn-cgi\/challenge-platform\//,
  /^https?:\/\/challenges\.cloudflare\.com\//,
];

/** reCAPTCHA, hCaptcha or Turnstile frames (spec §5.5). Invisible reCAPTCHA never asks a person. */
export function isCaptchaFrameUrl(url: string): boolean {
  if (/[?&]size=invisible\b/.test(url)) return false;
  return FRAME_PATTERNS.some((pattern) => pattern.test(url));
}

/** Full-page bot challenges, such as the Cloudflare interstitial. */
export function isChallengePage(url: string, title: string): boolean {
  return (
    /\/cdn-cgi\/challenge-platform\//.test(url) || /^just a moment\.{0,3}$/i.test(title.trim())
  );
}
