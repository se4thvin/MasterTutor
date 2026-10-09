import { probeSlot } from "../../../apps/agent/src/slots/probe.ts";
const host = process.env.SLOT_IP;
if (!host) throw new Error("SLOT_IP required");
console.log(JSON.stringify(await probeSlot("browser-1", { resolveHost: async () => host })));
