import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapGarage, waitForGarageAdmin, type GarageKeySpec } from "./garage-admin.ts";
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
});
