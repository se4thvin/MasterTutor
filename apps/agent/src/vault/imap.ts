import type { ImapConfig } from "@mastertutor/contracts";
import { ImapFlow } from "imapflow";
import { lookup } from "node:dns/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isPrivateAddress } from "./runtime.ts";

const MAX_MESSAGE_BYTES = 256 * 1024;
const RECHECK_MS = 2_000;
const CODE_KEYWORD = /code|otp|one[- ]?time|verification|passcode|\bpin\b|sign[- ]?in|log[- ]?in/i;

export class ImapBlocked extends Error {
  constructor() {
    super("IMAP host resolves to a blocked address");
    this.name = "ImapBlocked";
  }
}

/** Text past this is never looked at: a code sits near the top of any real message (I2). */
const MAX_TEXT_CHARS = 64 * 1024;

/**
 * Markup removed in one pass with indexOf only (I2): no regex backtracks over hostile HTML.
 * <style> and <script> are skipped to their closing tag, or to the end when there is none; an
 * unclosed tag drops the rest.
 */
function stripHtml(body: string): string {
  const lower = body.toLowerCase();
  let out = "";
  let at = 0;
  while (at < body.length && out.length < MAX_TEXT_CHARS) {
    const open = body.indexOf("<", at);
    if (open < 0) {
      out += body.slice(at);
      break;
    }
    out += `${body.slice(at, open)} `;
    const raw = lower.startsWith("<style", open)
      ? "style"
      : lower.startsWith("<script", open)
        ? "script"
        : null;
    const end = raw ? lower.indexOf(`</${raw}`, open) : body.indexOf(">", open + 1);
    if (end < 0) break;
    const close = raw ? body.indexOf(">", end) : end;
    if (close < 0) break;
    at = close + 1;
  }
  return out;
}

/** Numeric and &nbsp; entities decoded; invisible format characters (zero-width) removed. */
function decodeText(text: string): string {
  return text
    .replace(/&#(\d{1,7});/g, (_, code: string) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code: string) => codePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/\p{Cf}/gu, "");
}

function codePoint(code: number): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
}

/** Picks the 4–8 digit code from a message: the one after a code keyword, or the only number. */
export function extractOtpCode(body: string, isHtml: boolean): string | null {
  const text = decodeText((isHtml ? stripHtml(body) : body).slice(0, MAX_TEXT_CHARS)).replace(
    /\s+/g,
    " ",
  );
  const candidates = [...text.matchAll(/(?<![\d-])(\d{4,8})(?![\d-])/g)];
  const near = candidates.find((m) =>
    CODE_KEYWORD.test(text.slice(Math.max(0, (m.index ?? 0) - 60), m.index)),
  );
  if (near?.[1]) return near[1];
  return candidates.length === 1 ? (candidates[0]?.[1] ?? null) : null;
}

export interface ImapCodeRequest {
  config: ImapConfig;
  password: string;
  /** The run reading: a message is used at most once per run, whichever alias watches the inbox. */
  runId: string;
  /**
   * Only mail that arrived after this sign-in attempt started counts (no stale codes from earlier
   * attempts). Senders are matched on the From header, which mail can forge: the code still has
   * to be accepted by the site the agent is on, and the window is minutes.
   */
  notBefore: Date;
  timeoutMs: number;
  signal: AbortSignal;
  /** Messages already used (Review Focus 5), keyed by run, mailbox and uid; mutated on success. */
  used: Set<string>;
  testMode: boolean;
  /** Checked before every inbox look (S7): a code the user typed into CodeSlots wins at once. */
  codeBox(): Promise<string | null>;
}

interface Part {
  part?: string;
  type: string;
  disposition?: string;
  childNodes?: Part[];
}

function findPart(node: Part, type: string): string | null {
  if (node.disposition === "attachment") return null;
  if (node.type === type) return node.part ?? "1";
  for (const child of node.childNodes ?? []) {
    const found = findPart(child, type);
    if (found) return found;
  }
  return null;
}

/** Certificate verification is never turned off, in any mode (R-E11). */
export const IMAP_TLS = { rejectUnauthorized: true } as const;

export interface ImapTransport {
  address: string;
  secure: boolean;
  doSTARTTLS: boolean;
}

const isLoopback = (address: string) => /^127\./.test(address) || address === "::1";

/**
 * Least privilege and TLS (R-E11): public addresses only, over TLS (993) or forced STARTTLS.
 * The single exception is a local test server (loopback or the `greenmail` service) in test
 * mode, reached in plain text, where there is no certificate to verify.
 */
export function imapTransport(input: {
  host: string;
  port: number;
  addresses: readonly string[];
  testMode: boolean;
}): ImapTransport | null {
  const first = input.addresses[0];
  if (!first) return null;
  const local = input.testMode && (input.host === "greenmail" || input.addresses.every(isLoopback));
  if (!local && input.addresses.some((address) => isPrivateAddress(address))) return null;
  const secure = input.port === 993;
  return { address: first, secure, doSTARTTLS: !secure && !local };
}

async function readText(client: ImapFlow, uid: number, part: string): Promise<string> {
  const download = await client.download(String(uid), part, { uid: true });
  if (!("content" in download) || !download.content) return "";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of download.content) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > MAX_MESSAGE_BYTES) break;
    chunks.push(buffer);
  }
  download.content.destroy();
  return Buffer.concat(chunks).toString("utf8");
}

async function newestCode(
  client: ImapFlow,
  request: ImapCodeRequest,
  parsed: Set<string>,
): Promise<string | null> {
  const uids = await client.search(
    { from: request.config.senderFilter, since: request.notBefore },
    { uid: true },
  );
  if (!uids || uids.length === 0) return null;
  const validity = client.mailbox ? String(client.mailbox.uidValidity) : "0";
  const mailbox = `${request.config.host}:${request.config.port}:${request.config.user}`;
  for (const uid of [...uids].sort((a, b) => b - a)) {
    const key = `${request.runId}|${mailbox}|${validity}|${uid}`;
    // A message read once without a code is not read again on the next recheck (I2).
    if (request.used.has(key) || parsed.has(key)) continue;
    parsed.add(key);
    const message = await client.fetchOne(
      String(uid),
      { internalDate: true, bodyStructure: true },
      { uid: true },
    );
    if (!message || !message.bodyStructure) continue;
    const at = message.internalDate ? new Date(message.internalDate) : null;
    if (!at || at < request.notBefore) continue;
    const plain = findPart(message.bodyStructure, "text/plain");
    const html = plain ? null : findPart(message.bodyStructure, "text/html");
    const part = plain ?? html;
    if (!part) continue;
    const code = extractOtpCode(await readText(client, uid, part), plain === null);
    if (code) {
      request.used.add(key);
      return code;
    }
  }
  return null;
}

/** Waits for new mail (IMAP IDLE "exists") or a periodic recheck, whichever comes first. */
async function waitForMail(client: ImapFlow, ms: number, signal: AbortSignal): Promise<void> {
  const stop = new AbortController();
  const both = AbortSignal.any([signal, stop.signal]);
  try {
    await Promise.race([
      once(client, "exists", { signal: both }).catch(() => undefined),
      delay(ms, undefined, { signal: both }).catch(() => undefined),
    ]);
  } finally {
    stop.abort();
  }
  signal.throwIfAborted();
}

/** Spec §9: the newest message from the configured sender within the window that holds a code. */
export async function waitForImapCode(
  request: ImapCodeRequest,
): Promise<{ code: string; source: "code_box" | "imap" } | null> {
  const addresses = (await lookup(request.config.host, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );
  const transport = imapTransport({
    host: request.config.host,
    port: request.config.port,
    addresses,
    testMode: request.testMode,
  });
  if (!transport) throw new ImapBlocked();
  // Connect to the address that was checked; SNI and certificate checks use the configured name.
  const client = new ImapFlow({
    host: transport.address,
    servername: request.config.host,
    port: request.config.port,
    secure: transport.secure,
    doSTARTTLS: transport.doSTARTTLS,
    auth: { user: request.config.user, pass: request.password },
    tls: IMAP_TLS,
    logger: false,
    // Connecting and the greeting count against the same wait (a slow server cannot stretch it).
    connectionTimeout: request.timeoutMs,
    greetingTimeout: request.timeoutMs,
  });
  const deadline = Date.now() + request.timeoutMs;
  const parsed = new Set<string>();
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (;;) {
        request.signal.throwIfAborted();
        const typed = await request.codeBox();
        if (typed) return { code: typed, source: "code_box" };
        const code = await newestCode(client, request, parsed);
        if (code) return { code, source: "imap" };
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        await waitForMail(client, Math.min(remaining, RECHECK_MS), request.signal);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
