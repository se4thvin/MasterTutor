import { OBSERVE_USERS } from "@mastertutor/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { O2Error, createO2Client } from "./client.ts";
import { o2Paths } from "./o2-api.ts";
import {
  provisionAlertDelivery,
  provisionRoot,
  provisionStreams,
  provisionUsers,
} from "./provision.ts";
import {
  TEST_OBSERVE_ROOT_PASSWORD,
  startTestOpenObserve,
  type TestOpenObserve,
} from "./testing.ts";

let o2: TestOpenObserve;
beforeAll(async () => {
  o2 = await startTestOpenObserve();
}, 180_000);
afterAll(async () => {
  await o2?.stop();
});

const viewerCan = (password: string) =>
  createO2Client({ baseUrl: o2.baseUrl, email: OBSERVE_USERS.viewer, password })
    .call("listStreams", "GET", o2Paths.streams("default"))
    .then(
      () => true,
      (error: unknown) => {
        if (error instanceof O2Error && error.status === 401) return false;
        throw error;
      },
    );

describe("provisioning against the pinned image", () => {
  it("is idempotent, leaves a working viewer, and rotates a changed password", async () => {
    const passwords = {
      ingest: "Ingest-password-0123456789abcdefghij",
      viewer: "Viewer-password-0123456789abcdefghij",
    };
    for (let run = 0; run < 2; run++) {
      await provisionUsers(o2.root, passwords);
      await provisionStreams(o2.root);
      await provisionAlertDelivery(o2.root, {
        url: "http://web:3000/api/alerts/webhook",
        secret: "s".repeat(40),
      });
    }
    expect(await viewerCan(passwords.viewer)).toBe(true);
    const rotated = { ...passwords, viewer: "Rotated-viewer-password-0123456789ab" };
    await provisionUsers(o2.root, rotated);
    expect(await viewerCan(rotated.viewer)).toBe(true);
    expect(await viewerCan(passwords.viewer)).toBe(false);
    await expect(o2.root.call("health", "GET", o2Paths.health())).resolves.toBeDefined();
  });

  it("rotates root from OBSERVE_ROOT_PASSWORD_PREVIOUS, then is idempotent; refuses loudly otherwise (review I4)", async () => {
    const rotated = "Rotated-root-password-0123456789abcd";
    const rootCan = (password: string) =>
      createO2Client({ baseUrl: o2.baseUrl, email: OBSERVE_USERS.root, password })
        .call("listUsers", "GET", o2Paths.users("default"))
        .then(
          () => true,
          (error: unknown) => {
            if (error instanceof O2Error && error.status === 401) return false;
            throw error;
          },
        );
    await expect(provisionRoot({ baseUrl: o2.baseUrl, current: rotated })).rejects.toThrow(
      /OBSERVE_ROOT_PASSWORD_PREVIOUS/,
    );
    await provisionRoot({
      baseUrl: o2.baseUrl,
      current: rotated,
      previous: TEST_OBSERVE_ROOT_PASSWORD,
    });
    expect(await rootCan(rotated)).toBe(true);
    expect(await rootCan(TEST_OBSERVE_ROOT_PASSWORD)).toBe(false);
    // The next deploy still carries PREVIOUS: nothing changes.
    await provisionRoot({
      baseUrl: o2.baseUrl,
      current: rotated,
      previous: TEST_OBSERVE_ROOT_PASSWORD,
    });
    expect(await rootCan(rotated)).toBe(true);
  });
});
