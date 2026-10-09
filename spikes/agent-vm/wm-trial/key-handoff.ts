/** Runtime-only authorized bench Env read. No credential reaches argv, env metadata, or a file. */
import { authorizedKey } from "./bench-key.ts";
import type { BenchInspect } from "./bench-key.ts";
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
async function inspect() {
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}'], { encoding: "utf8" }).trim();
  if (!endpoint.startsWith("unix://")) throw new Error("Unix Docker API required");
  return new Promise<BenchInspect>((resolve,reject) => {
    const request = http.get({ socketPath: endpoint.slice(7), path: "/containers/mastertutor-bench-agent-1/json", timeout: 5000 }, response => {
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", chunk => { size += chunk.length; if (size > 4*1024*1024) { request.destroy(); reject(new Error("oversized Docker response")); } else chunks.push(chunk); });
      response.on("end", () => {
        try { if (response.statusCode !== 200) throw new Error("bench unavailable"); resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error("invalid Docker response")); }
      });
    });
    request.on("error", () => reject(new Error("Docker unavailable")));
    request.on("timeout", () => { request.destroy(); reject(new Error("Docker timeout")); });
  });
}
try {
  const bench = await inspect();
  let apiKey: string | undefined = authorizedKey(bench);
  if (bench.Config) bench.Config.Env = [];
  const child = spawn("ssh", ["-o", "ControlMaster=no", "-o", "ControlPath=none", "coursebite-build", "cd mt-vm-p0/houndshark-vm-p0 && bash spikes/agent-vm/wm-trial/model.sh"], { stdio: ["pipe", "inherit", "inherit"] });
  child.stdin.on("error", () => { /* Handoff failed; never include its contents in diagnostics. */ });
  child.stdin.end(JSON.stringify({ apiKey })+"\n"); apiKey = undefined;
  child.on("error", () => { console.log(JSON.stringify({ model_skipped: "secure_handoff_unavailable", spend_usd: 0 })); process.exitCode=1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} catch {
  console.log(JSON.stringify({ model_skipped: "authorized_runtime_key_unavailable", spend_usd: 0 })); process.exitCode=1;
}
