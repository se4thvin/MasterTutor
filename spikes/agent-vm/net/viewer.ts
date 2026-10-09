import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { liveEmbedPath } from "@mastertutor/contracts";
declare global { interface Window { p0Peers: RTCPeerConnection[] } }
const sample = () => JSON.parse(execFileSync("docker", ["exec", "mt-vm-p0-net-fc", "python3", "-c", "import json,pathlib; print(json.dumps({'cpu':int(dict(line.split() for line in pathlib.Path('/sys/fs/cgroup/cpu.stat').read_text().splitlines())['usage_usec']),'memory':int(pathlib.Path('/sys/fs/cgroup/memory.current').read_text())}))"], { encoding: "utf8" }));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
try {
  const page = await browser.newPage();
  const http: Record<string, number> = {};
  page.on("response", response => { const key = `${response.request().resourceType()}:${response.status()}`; http[key] = (http[key] ?? 0) + 1; });
  await page.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    window.p0Peers = [];
    window.RTCPeerConnection = class extends Native {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        window.p0Peers.push(this);
      }
    };
  });
  await page.goto("http://127.0.0.1:18089" + liveEmbedPath("00000000-0000-4000-8000-000000000001"));
  try {
    await page.waitForFunction(() => [...document.querySelectorAll("video")].some(v => v.videoWidth === 1280 && v.currentTime > 0), undefined, { timeout: 30000 });
  } catch {
    console.log(JSON.stringify({ http, viewer: await page.evaluate(() => ({
      videos: [...document.querySelectorAll("video")].map(v => ({ width: v.videoWidth, time: v.currentTime })),
      password_visible: [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].some(v => v.getBoundingClientRect().width > 0),
      peers: window.p0Peers.map(p => ({ ice: p.iceConnectionState, connection: p.connectionState, signaling: p.signalingState })),
    })) }));
    throw new Error("video did not start within the fixed 30-second window");
  }
  const stats = () => page.evaluate(async () => {
    type Stat = { id: string; type: string; kind?: string; framesDecoded?: number; timestamp: number; selectedCandidatePairId?: string; remoteCandidateId?: string; protocol?: string; framesPerSecond?: number };
    const reports: Stat[] = (await Promise.all(window.p0Peers.map((p: RTCPeerConnection) => p.getStats()))).flatMap((r: RTCStatsReport) => [...r.values()]);
    const video = reports.find((r: Stat) => r.type === "inbound-rtp" && r.kind === "video");
    const transport = reports.find((r: Stat) => r.type === "transport" && r.selectedCandidatePairId);
    const pair = reports.find((r: Stat) => r.id === transport?.selectedCandidatePairId);
    const candidate = reports.find((r: Stat) => r.id === pair?.remoteCandidateId);
    return { frames: video?.framesDecoded ?? 0, timestamp: video?.timestamp ?? 0, protocol: candidate?.protocol ?? null, fps: video?.framesPerSecond ?? 0 };
  });
  const cdp = await chromium.connectOverCDP(process.env.CDP_URL!);
  try {
    const guest = cdp.contexts()[0].pages()[0];
    await guest.goto("http://127.0.0.1:8000/");
    await guest.evaluate(() => {
      let last = 0;
      const scroll = (t: number) => { if (t-last > 30) { window.scrollBy(0, 20); if (window.scrollY + window.innerHeight >= document.body.scrollHeight) window.scrollTo(0,0); last=t; } requestAnimationFrame(scroll); };
      requestAnimationFrame(scroll);
    });
    await page.waitForTimeout(5000);
    const first = await stats(); const cpuFirst = sample(); const start = performance.now();
    const intervals = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      intervals.push({ ...await stats(), ...sample() });
    }
    const end = performance.now(); const last = intervals.at(-1)!;
    console.log(JSON.stringify({ duration_ms: end-start, tcp_mux: last.protocol === "tcp", decoded_fps: (last.frames-first.frames)*1000/(last.timestamp-first.timestamp), cpu_cores: (last.cpu-cpuFirst.cpu)/((end-start)*1000), intervals }));
  } finally { await cdp.close(); }
} finally { await browser.close(); }
