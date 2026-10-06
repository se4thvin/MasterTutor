import { describe, expect, it } from "vitest";
import { isCaptchaFrameUrl, isChallengePage } from "./captcha.ts";

describe("CAPTCHA detection", () => {
  it.each([
    "https://www.google.com/recaptcha/api2/anchor?k=x",
    "https://www.recaptcha.net/recaptcha/enterprise/bframe?k=x",
    "https://newassets.hcaptcha.com/captcha/v1/abc",
    "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile",
    "http://site.fixtures.test/recaptcha/api2/anchor?k=fixture",
  ])("flags %s", (url) => expect(isCaptchaFrameUrl(url)).toBe(true));
  it("ignores invisible reCAPTCHA (Review Focus 4) and ordinary frames", () => {
    expect(
      isCaptchaFrameUrl("https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible"),
    ).toBe(false);
    expect(isCaptchaFrameUrl("https://www.youtube.com/embed/abc")).toBe(false);
  });
  it("flags challenge interstitials", () => {
    expect(isChallengePage("https://a.com/", "Just a moment...")).toBe(true);
    expect(isChallengePage("https://a.com/cdn-cgi/challenge-platform/x", "A")).toBe(true);
    expect(isChallengePage("https://a.com/", "Home")).toBe(false);
  });
});
