import { describe, expect, it } from "vitest";
import { IMAP_TLS, extractOtpCode, imapTransport } from "./imap.ts";

describe("extractOtpCode", () => {
  it("takes the code next to a code keyword", () => {
    expect(
      extractOtpCode(
        "Your one-time verification code is 482913. It expires in 5 minutes. (c) 2026",
        false,
      ),
    ).toBe("482913");
    expect(extractOtpCode("Order 2026-1199\nUse code 7741 to sign in.", false)).toBe("7741");
  });

  it("reads HTML mail without markup or styles", () => {
    expect(
      extractOtpCode(
        "<style>.x{width:1200px}</style><p>Your login code:</p><p><b>903 1</b></p><p><b>551234</b></p>",
        true,
      ),
    ).toBe("551234");
  });

  it("accepts a lone number and gives up when it cannot tell which number is the code", () => {
    expect(extractOtpCode("123456", false)).toBe("123456");
    expect(extractOtpCode("Call 5551234 or 5559876", false)).toBeNull();
    expect(extractOtpCode("No digits here", false)).toBeNull();
  });
});

describe("imapTransport (R-E11)", () => {
  const publicIp = ["93.184.216.34"];
  it("uses TLS on 993 and forces STARTTLS elsewhere for public hosts, in every mode", () => {
    for (const testMode of [false, true]) {
      expect(
        imapTransport({ host: "imap.example.com", port: 993, addresses: publicIp, testMode }),
      ).toEqual({
        address: "93.184.216.34",
        secure: true,
        doSTARTTLS: false,
      });
      expect(
        imapTransport({ host: "imap.example.com", port: 143, addresses: publicIp, testMode }),
      ).toEqual({
        address: "93.184.216.34",
        secure: false,
        doSTARTTLS: true,
      });
    }
  });
  it("refuses private addresses, except a local test server in test mode", () => {
    expect(
      imapTransport({ host: "localhost", port: 3143, addresses: ["127.0.0.1"], testMode: false }),
    ).toBeNull();
    expect(
      imapTransport({ host: "mail.internal", port: 143, addresses: ["10.0.0.5"], testMode: true }),
    ).toBeNull();
    expect(
      imapTransport({
        host: "mixed.example",
        port: 143,
        addresses: ["93.184.216.34", "10.0.0.5"],
        testMode: false,
      }),
    ).toBeNull();
    expect(
      imapTransport({ host: "localhost", port: 3143, addresses: ["127.0.0.1"], testMode: true }),
    ).toEqual({
      address: "127.0.0.1",
      secure: false,
      doSTARTTLS: false,
    });
    expect(
      imapTransport({ host: "greenmail", port: 3143, addresses: ["172.18.0.4"], testMode: true }),
    ).toEqual({
      address: "172.18.0.4",
      secure: false,
      doSTARTTLS: false,
    });
    expect(imapTransport({ host: "nothing", port: 993, addresses: [], testMode: true })).toBeNull();
  });
  it("never turns certificate verification off", () => {
    expect(IMAP_TLS).toEqual({ rejectUnauthorized: true });
  });
});
