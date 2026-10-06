import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A scripted imapflow stand-in: what the agent asks of the server, and how it answers. */
const server = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  calls: [] as string[],
  lockFails: false,
  messages: [] as Array<{ uid: number; body: string }>,
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    mailbox = { uidValidity: 7n };
    constructor(options: Record<string, unknown>) {
      server.options.push(options);
    }
    on() {}
    off() {}
    async connect() {
      server.calls.push("connect");
    }
    async getMailboxLock() {
      server.calls.push("lock");
      if (server.lockFails) throw new Error("NO [ALERT] lock refused");
      return { release: () => server.calls.push("release") };
    }
    async logout() {
      server.calls.push("logout");
    }
    async search() {
      return server.messages.map((message) => message.uid);
    }
    async fetchOne(uid: string) {
      return {
        internalDate: new Date(),
        bodyStructure: { type: "text/plain", part: "1" },
        uid: Number(uid),
      };
    }
    async download(uid: string) {
      server.calls.push(`download:${uid}`);
      const body = server.messages.find((message) => String(message.uid) === uid)?.body ?? "";
      return { content: Readable.from([Buffer.from(body)]) };
    }
  },
}));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "127.0.0.1", family: 4 }] }));

const { extractOtpCode, waitForImapCode } = await import("./imap.ts");

const request = (overrides: Record<string, unknown> = {}) => ({
  config: { host: "localhost", port: 3143, user: "otp", senderFilter: "no-reply@fixtures.test" },
  password: "pw",
  itemId: "item-1",
  mailbox: "localhost:3143:otp",
  runId: "run-1",
  notBefore: new Date(0),
  timeoutMs: 300,
  signal: new AbortController().signal,
  used: new Set<string>(),
  testMode: true,
  codeBox: async () => null,
  ...overrides,
});

beforeEach(() => {
  server.options.length = 0;
  server.calls.length = 0;
  server.lockFails = false;
  server.messages = [];
});

describe("extractOtpCode on hostile mail (review I2)", () => {
  it("handles a crafted 256 KiB body in linear time", () => {
    for (const body of ["<a".repeat(131_072), "<style".repeat(43_690), "<script>".repeat(32_768)]) {
      const started = performance.now();
      extractOtpCode(body, true);
      expect(performance.now() - started, body.slice(0, 8)).toBeLessThan(100);
    }
  });

  it("reads a code split by numeric entities such as a zero-width space", () => {
    expect(extractOtpCode("<p>Your code is 123&#8203;456</p>", true)).toBe("123456");
    expect(extractOtpCode("<p>Your code is 482&#x200B;913</p>", true)).toBe("482913");
  });
});

describe("waitForImapCode connection hygiene", () => {
  it("logs out when the mailbox lock fails, instead of leaking the session", async () => {
    server.lockFails = true;
    await expect(waitForImapCode(request() as never)).rejects.toThrow(/lock refused/);
    expect(server.calls).toEqual(["connect", "lock", "logout"]);
  });

  it("bounds connecting and greeting by the wait", async () => {
    await waitForImapCode(request() as never);
    expect(server.options[0]).toMatchObject({ connectionTimeout: 300, greetingTimeout: 300 });
  });

  it("parses a message without a code once, not on every recheck", async () => {
    server.messages = [{ uid: 5, body: "Welcome aboard, nothing to see here." }];
    await waitForImapCode(request({ timeoutMs: 2_500 }) as never);
    expect(server.calls.filter((call) => call === "download:5")).toHaveLength(1);
  });

  it("lets one run use a message once, whichever alias watches that inbox (review: per run)", async () => {
    server.messages = [{ uid: 9, body: "Your code is 482913" }];
    const used = new Set<string>();
    expect(await waitForImapCode(request({ used, itemId: "a" }) as never)).toEqual({
      code: "482913",
      source: "imap",
    });
    expect(await waitForImapCode(request({ used, itemId: "b" }) as never)).toBeNull();
  });
});
