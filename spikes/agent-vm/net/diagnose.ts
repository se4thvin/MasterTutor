import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP(process.env.CDP_URL!);
try {
  const page = browser.contexts()[0].pages()[0];
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { resource } = await cdp.send("Network.loadNetworkResource", { frameId: frameTree.frame.id, url: "file:///var/log/neko/neko.log", options: { disableCache: true, includeCredentials: false } });
  if (!resource.success || !resource.stream) throw new Error("diagnostic resource unavailable");
  let log = "";
  for (;;) {
    const chunk = await cdp.send("IO.read", { handle: resource.stream, size: 65536 });
    log += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString() : chunk.data;
    if (chunk.eof || log.length > 1048576) break;
  }
  await cdp.send("IO.close", { handle: resource.stream });
  // Public source locations only. Never emit log text, error values, arguments, or credentials.
  const frames = [...new Set(log.match(/(?:github\.com\/m1k1o\/neko\/server\/|\/src\/server\/)[a-z/]+\.go:[0-9]+/g) ?? [])];
  const modules = new Set<string>();
  for (const line of log.split("\n")) {
    try {
      const value = JSON.parse(line);
      for (const key of ["module", "submodule"]) if (["capture", "gstreamer", "streamsrc", "streamsink", "audio", "video", "broadcast", "screencast"].includes(value[key])) modules.add(value[key]);
    } catch { /* Not a JSON diagnostic line. */ }
  }
  console.log(JSON.stringify({ public_source_frames: frames, module_categories: [...modules] }));
} catch { console.log(JSON.stringify({ diagnostic_available: false })); }
finally { await browser.close(); }
