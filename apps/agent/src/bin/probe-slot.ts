import { probeSlot } from "../slots/probe.ts";

const name = process.argv[2];
if (!name) {
  console.error("usage: node apps/agent/src/bin/probe-slot.ts <browser-N>");
  process.exit(64);
}
console.log(JSON.stringify(await probeSlot(name)));
