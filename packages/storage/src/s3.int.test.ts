import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapGarage, waitForGarageAdmin } from "./garage-admin.ts";
import { ObjectNotFound, createStorage, type Storage } from "./s3.ts";
import { startTestGarage, type TestGarage } from "./testing.ts";

const WEB = {
  name: "web",
  accessKeyId: "GK111111111111111111111111",
  secretAccessKey: "1".repeat(64),
  read: true,
  write: false,
};
const AGENT = {
  name: "agent",
  accessKeyId: "GK222222222222222222222222",
  secretAccessKey: "2".repeat(64),
  read: true,
  write: true,
};
let garage: TestGarage;
let agent: Storage;
let web: Storage;

beforeAll(async () => {
  garage = await startTestGarage();
  await waitForGarageAdmin({ adminUrl: garage.adminUrl, adminToken: garage.adminToken });
  await bootstrapGarage({
    adminUrl: garage.adminUrl,
    adminToken: garage.adminToken,
    bucket: "mastertutor",
    keys: [WEB, AGENT],
    capacityBytes: 1024 ** 3,
  });
  const as = (key: typeof WEB) =>
    createStorage({
      endpoint: garage.s3Endpoint,
      region: "garage",
      bucket: "mastertutor",
      accessKeyId: key.accessKeyId,
      secretAccessKey: key.secretAccessKey,
    });
  agent = as(AGENT);
  web = as(WEB);
});
afterAll(async () => {
  await garage?.stop();
});

describe("Storage against Garage", () => {
  it("round-trips an object with its sha256 metadata", async () => {
    await agent.ping();
    await agent.put("runs/r/steps/1.png", new Uint8Array([1, 2, 3]), {
      contentType: "image/png",
      sha256: "a".repeat(64),
    });
    expect(Array.from(await agent.getBytes("runs/r/steps/1.png"))).toEqual([1, 2, 3]);
    expect(await agent.head("runs/r/steps/1.png")).toEqual({
      bytes: 3,
      contentType: "image/png",
      sha256: "a".repeat(64),
    });
    const response = await fetch(await agent.presignGet("runs/r/steps/1.png", 60));
    expect(response.status).toBe(200);
    await agent.delete("runs/r/steps/1.png");
    expect(await agent.head("runs/r/steps/1.png")).toBeNull();
  });

  it("gives web a read-only key", async () => {
    await agent.put("assets/x/readable", "hello", { contentType: "text/plain" });
    expect(new TextDecoder().decode(await web.getBytes("assets/x/readable"))).toBe("hello");
    await expect(
      web.put("assets/x/forbidden", "nope", { contentType: "text/plain" }),
    ).rejects.toThrow();
  });

  it("tells a missing object from other getStream failures (QA-086)", async () => {
    await expect(web.getStream("assets/x/never-written")).rejects.toBeInstanceOf(ObjectNotFound);
  });

  it("streams an object", async () => {
    await agent.put("assets/stream-test", new Uint8Array([1, 2, 3]), {
      contentType: "application/octet-stream",
    });
    const bytes = new Uint8Array(
      await new Response(await agent.getStream("assets/stream-test")).arrayBuffer(),
    );
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("streams a local file in with putFile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "putfile-"));
    const file = join(dir, "blob.bin");
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    await writeFile(file, bytes);
    await agent.putFile("downloads/00000000-0000-4000-8000-000000000001/blob.bin", file, {
      contentType: "application/octet-stream",
      sha256: "b".repeat(64),
    });
    expect(await agent.getBytes("downloads/00000000-0000-4000-8000-000000000001/blob.bin")).toEqual(
      bytes,
    );
    expect(
      await agent.head("downloads/00000000-0000-4000-8000-000000000001/blob.bin"),
    ).toMatchObject({ bytes: bytes.length, sha256: "b".repeat(64) });
  });
});
