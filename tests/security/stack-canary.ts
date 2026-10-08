/**
 * Post-E2E secret canary scan of a running stack (spec §12 security test 1). It reads a Postgres
 * data dump, every service's logs, every Garage object, the agent's downloads volume and the
 * llm-mock request log, and OCRs every stored image. It prints canary names and places, never
 * values. Exits 1 on any hit, any OpenAI data-policy problem (D38) or any source it could not read.
 * Usage (scripts/e2e.sh passes its own compose command; COMPOSE_PROJECT_NAME is inherited):
 *   node tests/security/stack-canary.ts docker compose --env-file .env.test -f compose.yml -f compose.test.yml --profile e2e
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createOcr } from "../../apps/agent/src/vault/testing/ocr.ts";
import { requestPolicyProblem } from "../llm-mock/src/server.ts";
import type { RecordedRequest } from "../llm-mock/src/scenario.ts";
import { STACK_CANARIES } from "./canaries.ts";
import {
  describeHit,
  findCanaryHits,
  findOcrHits,
  findStoredDigitHits,
  type Canaries,
  type CanaryHit,
} from "./canary-core.ts";

export type SourceKind = "database" | "logs" | "object" | "download" | "model-requests";
export interface Source {
  kind: SourceKind;
  where: string;
  bytes: Buffer;
  /** Canaries this source holds by configuration (a mail server's own mailbox): not a leak here. */
  own?: readonly string[];
}
export type Scanned = Record<SourceKind | "ocr", number>;

export function imageKind(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  const ascii = (from: number, to: number) =>
    Buffer.from(bytes.subarray(from, to)).toString("latin1");
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Digit canaries collide with ids and timings, so only a model input or a screen is searched for them (P7-34). */
export function canariesFor(kind: SourceKind, canaries: Canaries): Canaries {
  if (kind === "model-requests") return canaries;
  return Object.fromEntries(
    Object.entries(canaries).filter(([, value]) => !/^[0-9]+$/.test(value)),
  );
}

const DATA_URL_IMAGE = /data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)/g;

/** The images inlined as data URLs in a model request log. */
export function dataUrlImages(text: string): Buffer[] {
  return [...text.matchAll(DATA_URL_IMAGE)].map((match) => Buffer.from(match[1]!, "base64"));
}

export async function scanSources(
  sources: readonly Source[],
  canaries: Canaries,
  ocrText: (image: Buffer) => Promise<string>,
): Promise<{ hits: CanaryHit[]; scanned: Scanned }> {
  const hits: CanaryHit[] = [];
  const scanned: Scanned = {
    database: 0,
    logs: 0,
    object: 0,
    download: 0,
    "model-requests": 0,
    ocr: 0,
  };
  for (const source of sources) {
    scanned[source.kind] += 1;
    hits.push(
      ...findCanaryHits(
        source.bytes.toString("latin1"),
        source.where,
        Object.fromEntries(
          Object.entries(canariesFor(source.kind, canaries)).filter(
            ([name]) => !source.own?.includes(name),
          ),
        ),
      ),
    );
    if (source.kind !== "model-requests") {
      const own = Object.fromEntries(
        Object.entries(canaries).filter(([name]) => !source.own?.includes(name)),
      );
      hits.push(...findStoredDigitHits(source.bytes.toString("latin1"), source.where, own));
    }
    if ((source.kind === "object" || source.kind === "download") && imageKind(source.bytes)) {
      scanned.ocr += 1;
      hits.push(...findOcrHits(await ocrText(source.bytes), `ocr ${source.where}`, canaries));
    }
    // Every screenshot the model was sent, read as the model read it (spec §12, review M1).
    if (source.kind === "model-requests") {
      let index = 0;
      for (const image of dataUrlImages(source.bytes.toString("latin1"))) {
        index += 1;
        scanned.ocr += 1;
        hits.push(
          ...findOcrHits(await ocrText(image), `ocr ${source.where} image ${index}`, canaries),
        );
      }
    }
  }
  return { hits, scanned };
}

/** A scan that read nothing proves nothing: after an E2E run every one of these is non-empty. */
export function vacuousSources(scanned: Scanned): string[] {
  return (["database", "logs", "model-requests", "object", "ocr"] as const)
    .filter((kind) => scanned[kind] === 0)
    .map((kind) => `nothing scanned: ${kind}`);
}

/**
 * Each defined service's logs, read separately so a service's own configured secrets can be told
 * apart. `config --services` lists exited and crashed services too, not only running ones (M8).
 */
export function collectLogs(
  run: (args: string[]) => Buffer,
  own: Readonly<Record<string, readonly string[]>>,
): Source[] {
  return run(["config", "--services"])
    .toString("utf8")
    .split("\n")
    .filter((service) => service !== "")
    .map((service) => ({
      kind: "logs" as const,
      where: `logs ${service}`,
      bytes: run(["logs", "--no-color", service]),
      own: own[service] ?? [],
    }));
}

/**
 * Secrets a service is configured with, so its own logs may name them: greenmail prints its
 * launch options (GREENMAIL_OPTS, which define the test mailbox). Anywhere else they are a leak.
 */
const OWN_SECRETS: Record<string, readonly string[]> = { greenmail: ["imapPassword"] };

const DEFAULT_COMPOSE = [
  "docker",
  "compose",
  "--env-file",
  ".env.test",
  "-f",
  "compose.yml",
  "-f",
  "compose.test.yml",
  "--profile",
  "e2e",
];
const MOCK_DUMP =
  "fetch(new URL('/__mock/requests', process.env.OPENAI_BASE_URL)).then(async (r) => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()); })";

function filesUnder(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : entry.isFile() ? [full] : [];
  });
}

function collect(compose: readonly string[], out: string): Source[] {
  const run = (args: string[], input?: Buffer) =>
    execFileSync(compose[0]!, [...compose.slice(1), ...args], { maxBuffer: 1 << 30, input });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const sources: Source[] = [
    {
      kind: "database",
      where: "postgres",
      bytes: run([
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "-U",
        "owner",
        "-d",
        "mastertutor",
        "--data-only",
      ]),
    },
    ...collectLogs(run, OWN_SECRETS),
    {
      kind: "model-requests",
      where: "llm-mock requests",
      bytes: run(["exec", "-T", "agent", "node", "-e", MOCK_DUMP]),
    },
  ];
  // Every Garage object, read by the running agent with its own S3 key (dump-objects.ts on stdin;
  // a second agent container would clash with the running one's static cdp address).
  const dump = run(
    [
      "exec",
      "-T",
      "-w",
      "/app/packages/storage",
      "agent",
      "node",
      "--input-type=module-typescript",
      "-",
    ],
    readFileSync(resolve("tests/security/dump-objects.ts")),
  );
  for (const line of dump.toString("utf8").split("\n")) {
    if (line === "") continue;
    const object = JSON.parse(line) as { key: string; body: string };
    sources.push({
      kind: "object",
      where: `object ${object.key}`,
      bytes: Buffer.from(object.body, "base64"),
    });
  }
  run(["cp", "agent:/downloads", join(out, "downloads")]);
  for (const file of filesUnder(join(out, "downloads"))) {
    sources.push({
      kind: "download",
      where: `download ${relative(out, file)}`,
      bytes: readFileSync(file),
    });
  }
  return sources;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const compose = argv.length > 0 ? argv : DEFAULT_COMPOSE;
  if (compose[0] !== "docker" || compose[1] !== "compose") {
    process.stderr.write(
      "usage: node tests/security/stack-canary.ts [docker compose <global options>]\n",
    );
    process.exit(2);
  }
  const out = resolve("tests/security/.out");
  const sources = collect(compose, out);
  const ocr = await createOcr();
  let result: Awaited<ReturnType<typeof scanSources>>;
  try {
    result = await scanSources(sources, STACK_CANARIES, (image) => ocr.text(image));
  } finally {
    await ocr.close();
  }
  const requestLog = sources.find((source) => source.kind === "model-requests")!;
  const requests = JSON.parse(requestLog.bytes.toString("utf8")) as RecordedRequest[];
  // The mock's own per-request data-policy check (D38). P3's policyProblems() (tests/llm-mock/src/
  // policy.ts, which also covers embeddings) replaces this when B2/B4/B5 merges.
  const policy = requests
    .filter((request) => request.path === "/v1/responses")
    .flatMap((request) => {
      const problem = requestPolicyProblem(request.body);
      return problem ? [`${request.scenario ?? "unrouted"}: ${problem}`] : [];
    });
  const problems = [
    ...result.hits.map(describeHit),
    ...policy.map((problem) => `model request policy: ${problem}`),
    ...vacuousSources(result.scanned),
    ...(requests.length === 0 ? ["nothing scanned: no model requests were recorded"] : []),
  ];
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify({ hits: result.hits, policy, scanned: result.scanned }, null, 2),
  );
  for (const problem of problems) console.error(`CANARY SCAN: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`canary scan clean: ${JSON.stringify(result.scanned)}`);
}
