import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapGarage, waitForGarageAdmin, type GarageKeySpec } from "./garage-admin.ts";
import { createStorage } from "./s3.ts";
import { startTestGarage, type TestGarage } from "./testing.ts";

const keys: GarageKeySpec[] = [
  {
    name: "web",
    accessKeyId: "GK111111111111111111111111",
    secretAccessKey: "1".repeat(64),
    read: true,
    write: false,
  },
  {
    name: "agent",
    accessKeyId: "GK222222222222222222222222",
    secretAccessKey: "2".repeat(64),
    read: true,
    write: true,
  },
];
let garage: TestGarage;

beforeAll(async () => {
  garage = await startTestGarage();
  await waitForGarageAdmin({ adminUrl: garage.adminUrl, adminToken: garage.adminToken });
});
afterAll(async () => {
  await garage?.stop();
});

describe("bootstrapGarage against Garage v2.3.0", () => {
  it("initializes once and is idempotent", async () => {
    const options = {
      adminUrl: garage.adminUrl,
      adminToken: garage.adminToken,
      bucket: "mastertutor",
      keys,
      capacityBytes: 1024 ** 3,
    };
    const first = await bootstrapGarage(options);
    expect(first.createdBucket).toBe(true);
    expect(first.importedKeys).toEqual(["web", "agent"]);
    expect(first.layoutVersion).toBe(1);
    const second = await bootstrapGarage(options);
    expect(second).toEqual({ ...first, createdBucket: false, importedKeys: [] });
  });

  it("refuses a new secret under an existing key id (D61, real Garage v2.3.0 API shape)", async () => {
    const rotated = keys.map((key) =>
      key.name === "web" ? { ...key, secretAccessKey: "9".repeat(64) } : key,
    );
    await expect(
      bootstrapGarage({
        adminUrl: garage.adminUrl,
        adminToken: garage.adminToken,
        bucket: "mastertutor",
        keys: rotated,
      }),
    ).rejects.toThrow(/web/);
  });
});

describe("OpenObserve's bucket is isolated (spec §11, §14)", () => {
  it("its key reads and writes only its bucket; app keys cannot reach it", async () => {
    const observeKey = {
      name: "openobserve",
      accessKeyId: "GK333333333333333333333333",
      secretAccessKey: "3".repeat(64),
      read: true,
      write: true,
    };
    const common = {
      adminUrl: garage.adminUrl,
      adminToken: garage.adminToken,
      capacityBytes: 1024 ** 3,
    };
    await bootstrapGarage({ ...common, bucket: "mastertutor", keys });
    await bootstrapGarage({ ...common, bucket: "observability", keys: [observeKey] });
    const as = (bucket: string, key: { accessKeyId: string; secretAccessKey: string }) =>
      createStorage({ endpoint: garage.s3Endpoint, region: "garage", bucket, ...key });
    await as("observability", observeKey).put("files/x", "ok", { contentType: "text/plain" });
    expect(
      new TextDecoder().decode(await as("observability", observeKey).getBytes("files/x")),
    ).toBe("ok");
    // The object exists, so a refusal is the key's scope, not a missing object.
    await as("mastertutor", keys[1]!).put("assets/y", "app", { contentType: "text/plain" });
    await expect(as("mastertutor", observeKey).getBytes("assets/y")).rejects.toThrow();
    await expect(as("observability", keys[1]!).getBytes("files/x")).rejects.toThrow();
    await expect(as("observability", keys[0]!).getBytes("files/x")).rejects.toThrow();
  });
});
