const response = await fetch(`${process.env.SLOT_CONTROL}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "screenshot" }), signal: AbortSignal.timeout(35000) });
const result = await response.json();
if (!response.ok || typeof result.png !== "string") throw new Error("guest screenshot unavailable");
const png = Buffer.from(result.png, "base64");
console.log(JSON.stringify({ screenshot_bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20), source: "guest-xwd" }));
