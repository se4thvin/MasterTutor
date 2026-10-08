/**
 * The audio-capture service (B4 review I7): the only place a slot's audio is recorded. It runs in
 * its own container with no secrets, a read-only root and a tmpfs for chunks; it connects only to
 * a slot's PulseAudio port (slots admit 4713 from this container's address alone). The agent starts
 * a session, fetches each finished chunk (deleted once sent) and stops or deletes the session.
 * Contract: protocol.ts.
 */
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, rm, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PULSE_TCP_PORT } from "@mastertutor/contracts";
import {
  AUDIO_CAPTURE_PORT,
  AUDIO_START_LIMIT_MS,
  type AudioErrorCode,
  CHUNK_WAIT_MS,
  StartRequest,
  type StartAnswer,
} from "./protocol.ts";
import { type AudioRecording, startRecording } from "./recorder.ts";

/** One recording per slot at most; six slots, plus room for one being torn down. */
const MAX_SESSIONS = 8;
const MAX_REQUEST_BYTES = 4 * 1024;

interface Session {
  id: string;
  dir: string;
  recording: AudioRecording;
  chunks: Map<number, string>;
  /** Chunks written so far (served or not). */
  produced: number;
  stopped: Promise<void> | null;
  failed: boolean;
  waiters: Set<() => void>;
  expiry: NodeJS.Timeout;
}

export interface AudioCaptureOptions {
  /** Where chunks live (the container's tmpfs); emptied when the service starts. */
  root?: string;
  parecPath?: string;
  /** Resolves a slot name to its address on the internal network (tests stub it). */
  resolveSlot?: (slot: string) => Promise<string>;
  startLimitMs?: number;
}

const resolveIpv4 = async (host: string) => (await lookup(host, { family: 4 })).address;

export async function startAudioCaptureServer(
  port: number,
  options: AudioCaptureOptions = {},
): Promise<{ server: Server; port: number; close(): Promise<void> }> {
  const root = options.root ?? join(tmpdir(), "mt-audio");
  // Chunks a crashed run left behind never outlive a restart.
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true, mode: 0o700 });
  const sessions = new Map<string, Session>();
  const resolveSlot = options.resolveSlot ?? resolveIpv4;

  const notify = (session: Session) => {
    for (const waiter of [...session.waiters]) waiter();
  };
  const stop = (session: Session) => {
    session.stopped ??= session.recording.stop().catch(() => {
      session.failed = true;
    });
    void session.stopped.then(() => notify(session));
    return session.stopped;
  };
  const purge = async (session: Session) => {
    clearTimeout(session.expiry);
    sessions.delete(session.id);
    await stop(session);
    await rm(session.dir, { recursive: true, force: true });
  };

  async function startSession(body: unknown): Promise<[number, unknown]> {
    const request = StartRequest.safeParse(body);
    if (!request.success) return [400, { error: "bad_request" satisfies AudioErrorCode }];
    if (sessions.size >= MAX_SESSIONS) return [503, { error: "busy" satisfies AudioErrorCode }];
    let address: string;
    try {
      address = await resolveSlot(request.data.slot);
    } catch {
      return [503, { error: "audio_unavailable" satisfies AudioErrorCode }];
    }
    const id = randomUUID();
    const dir = join(root, id);
    await mkdir(dir, { mode: 0o700 });
    const recording = startRecording({
      server: `tcp:${address}:${PULSE_TCP_PORT}`,
      dir,
      chunkSeconds: request.data.chunkSeconds,
      ...(options.parecPath ? { parecPath: options.parecPath } : {}),
    });
    const session: Session = {
      id,
      dir,
      recording,
      chunks: new Map(),
      produced: 0,
      stopped: null,
      failed: false,
      waiters: new Set(),
      // The hard limit: whatever the agent does, nothing records or stays past it.
      expiry: setTimeout(() => void purge(session), request.data.maxSeconds * 1_000 + 60_000),
    };
    recording.onChunk((file, index) => {
      session.chunks.set(index, file);
      session.produced = Math.max(session.produced, index + 1);
      notify(session);
    });
    sessions.set(id, session);
    const limit = options.startLimitMs ?? AUDIO_START_LIMIT_MS;
    const ready = await Promise.race([
      recording.ready.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), limit).unref()),
    ]);
    if (!ready) {
      await purge(session);
      return [503, { error: "audio_unavailable" satisfies AudioErrorCode }];
    }
    const answer: StartAnswer = {
      id,
      bufferedMs: Math.min(limit, Math.max(0, Date.now() - recording.startedAt)),
    };
    return [200, answer];
  }

  /** Waits (≤ CHUNK_WAIT_MS) for chunk `index`, or for the session to end without it. */
  async function chunk(session: Session, index: number, res: ServerResponse): Promise<void> {
    const deadline = Date.now() + CHUNK_WAIT_MS;
    for (;;) {
      const file = session.chunks.get(index);
      if (file) {
        const bytes = await readFile(file);
        session.chunks.delete(index);
        // Deleted once read: the agent holds the only copy, in memory, until it is transcribed.
        await unlink(file).catch(() => undefined);
        res.writeHead(200, { "content-type": "audio/wav", "content-length": bytes.byteLength });
        res.end(bytes);
        return;
      }
      if (session.stopped) {
        // Every chunk is written once stop() settles: one that is not here never will be.
        await session.stopped;
        if (session.chunks.has(index)) continue;
        if (session.failed) return send(res, 500, { error: "recording_failed" });
        res.writeHead(204).end();
        return;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        res.writeHead(202).end();
        return;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          session.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, left);
        session.waiters.add(done);
      });
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "recording_failed" });
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://audio-capture");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/sessions") {
      const body = await readJson(req);
      const [status, answer] = await startSession(body);
      return send(res, status, answer);
    }
    const session = parts[0] === "sessions" && parts[1] ? sessions.get(parts[1]) : undefined;
    if (parts[0] !== "sessions" || !parts[1]) return send(res, 404, { error: "bad_request" });
    if (!session) return send(res, 404, { error: "unknown_session" });
    if (req.method === "GET" && parts[2] === "chunks" && /^\d{1,4}$/.test(parts[3] ?? ""))
      return chunk(session, Number(parts[3]), res);
    if (req.method === "POST" && parts[2] === "stop" && parts.length === 3) {
      await stop(session);
      return session.failed
        ? send(res, 500, { error: "recording_failed" })
        : send(res, 200, { chunks: session.produced });
    }
    if (req.method === "DELETE" && parts.length === 2) {
      await purge(session);
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "bad_request" });
  }

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address();
  return {
    server,
    port: typeof address === "object" && address ? address.port : port,
    async close() {
      await Promise.all([...sessions.values()].map(purge));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.byteLength;
    if (total > MAX_REQUEST_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startAudioCaptureServer(AUDIO_CAPTURE_PORT);
}
