import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A stand-in parec: streams raw s16le at `bytesPerTick` every 50 ms on stdout until SIGTERM, and
 * records its argv and environment next to itself (`<path>.args.json`).
 */
const FAKE_PAREC = `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(__filename + ".args.json", JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
const tick = Number(process.env.FAKE_PAREC_TICK_BYTES || "8000");
const timer = setInterval(() => process.stdout.write(Buffer.alloc(tick, 1)), 50);
process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
`;

export async function fakeParec(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mt-parec-"));
  const path = join(dir, "parec.cjs");
  await writeFile(path, FAKE_PAREC);
  await chmod(path, 0o755);
  return path;
}
