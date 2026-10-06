import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FIXTURE_HOSTS,
  startVaultFixtures,
  type VaultFixtures,
} from "../../../../tests/fixtures/vault-sites/server.ts";
import { describeGroup, disableRevealToggles, fillGroup, openTarget } from "./dom.ts";
import { launchTestBrowser, resolveSelector, type TestBrowser } from "./testing/browser.ts";

const account = {
  email: "me@example.test",
  password: "fixture-password-1",
  totpSeed: "JBSWY3DPEHPK3PXP",
  pin: "739146",
};
let fx: VaultFixtures;
let tb: TestBrowser;

async function target(selector: string, frameIndex?: number) {
  const frame = frameIndex === undefined ? undefined : tb.page.frames()[frameIndex];
  const ref = await resolveSelector(tb, selector, frame);
  const node = await openTarget(ref.cdp, ref.backendNodeId);
  if (!node) throw new Error(`could not open ${selector}`);
  return node;
}

beforeAll(async () => {
  fx = await startVaultFixtures({ account, mail: null });
  tb = await launchTestBrowser({ allowedOrigins: fx.origins });
});
afterAll(async () => {
  await tb?.close();
  await fx?.close();
});

describe("isolated-world DOM layer", () => {
  it("inspects a main-frame password input", async () => {
    await tb.page.goto(`${fx.origin("login")}/password`);
    const [box] = await describeGroup(await target("#password"));
    expect(box?.info).toMatchObject({
      tag: "input",
      type: "password",
      autocomplete: ["current-password"],
      origin: fx.origin("login"),
    });
  });

  it("reports an iframe input with the iframe's own origin (same-site and cross-site)", async () => {
    await tb.page.goto(`${fx.origin("login")}/iframe-same-site`);
    await tb.page.frames()[1]!.waitForSelector("#frame-password");
    expect((await describeGroup(await target("#frame-password", 1)))[0]?.info.origin).toBe(
      fx.origin("other"),
    );
    await tb.page.goto(`${fx.origin("login")}/iframe-cross-site`);
    await tb.page.frames()[1]!.waitForSelector("#frame-password");
    expect((await describeGroup(await target("#frame-password", 1)))[0]?.info.origin).toBe(
      fx.origin("evil"),
    );
  });

  it("sees the true input type even when the page tampers with the prototype", async () => {
    await tb.page.goto(`${fx.origin("login")}/tampered`);
    expect(
      await tb.page.evaluate(() => (document.getElementById("note") as HTMLInputElement).type),
    ).toBe("password");
    expect((await describeGroup(await target("#note")))[0]?.info.type).toBe("text");
  });

  it("looks for a password only inside the field's own form (S4)", async () => {
    await tb.page.goto(`${fx.origin("login")}/text-trap`);
    expect((await describeGroup(await target("#comment")))[0]?.info.hasPasswordInScope).toBe(false);
    await tb.page.goto(`${fx.origin("login")}/password`);
    expect((await describeGroup(await target("#email")))[0]?.info.hasPasswordInScope).toBe(true);
  });

  it("collects split boxes in DOM order starting at the target", async () => {
    await tb.page.goto(`${fx.origin("login")}/pin`);
    expect(await describeGroup(await target("#pin0"))).toHaveLength(6);
    expect(await describeGroup(await target("#pin2"))).toHaveLength(4);
  });

  it("fills a React-controlled input so React state changes", async () => {
    await tb.page.goto(`${fx.origin("login")}/react`);
    await tb.page.waitForSelector("#r-email");
    const pinned = { pinnedOrigin: fx.origin("login") };
    expect(
      await fillGroup(await describeGroup(await target("#r-email")), "me@example.test", {
        forcePassword: false,
        ...pinned,
      }),
    ).toBe("ok");
    expect(
      await fillGroup(await describeGroup(await target("#r-password")), "pw", {
        forcePassword: true,
        ...pinned,
      }),
    ).toBe("ok");
    expect(await tb.page.isEnabled("#r-submit")).toBe(true);
  });

  it("stops and clears when the page navigates away mid-fill", async () => {
    await tb.page.goto(`${fx.origin("login")}/redirect`);
    const group = await describeGroup(await target("#rpin0"));
    expect(
      await fillGroup(group, account.pin, {
        forcePassword: true,
        pinnedOrigin: fx.origin("login"),
      }),
    ).toBe("navigated");
    await tb.page.waitForURL(`${fx.origin("evil")}/landing`);
    expect(fx.requests.some((r) => r.host === FIXTURE_HOSTS.evil && r.path === "/collect")).toBe(
      false,
    );
  });

  it("treats a same-origin auto-submit on the last box as success", async () => {
    await tb.page.goto(`${fx.origin("login")}/pin-autosubmit`);
    const group = await describeGroup(await target("#pin0"));
    expect(
      await fillGroup(group, account.pin, {
        forcePassword: true,
        pinnedOrigin: fx.origin("login"),
      }),
    ).toBe("ok");
    await expect.poll(() => tb.page.textContent("#status").catch(() => null)).toBe("PIN accepted");
  });

  it("rejects a value whose length does not match the boxes", async () => {
    await tb.page.goto(`${fx.origin("login")}/pin`);
    expect(
      await fillGroup(await describeGroup(await target("#pin0")), "12", {
        forcePassword: true,
        pinnedOrigin: fx.origin("login"),
      }),
    ).toBe("length_mismatch");
  });

  it("disables the password reveal toggle and nothing else (S4, W6)", async () => {
    await tb.page.goto(`${fx.origin("login")}/password`);
    const [box] = await describeGroup(await target("#password"));
    expect(await disableRevealToggles(box!.node)).toBe(1);
    expect(await tb.page.isDisabled("#reveal")).toBe(true);
    expect(await tb.page.isEnabled("#submit")).toBe(true);
  });

  it("opens a same-origin iframe's field in its own frame, under its own frame id (I1)", async () => {
    await tb.page.goto(`${fx.origin("login")}/iframe-same-origin`);
    await tb.page.frames()[1]!.waitForSelector("#child-password");
    const { frameTree } = await (await tb.session.cdp()).send("Page.getFrameTree");
    const child = frameTree.childFrames![0]!.frame;
    const node = await target("#child-password", 1);
    expect(node.frameId).toBe(child.id);
    expect(node.loaderId).toBe(child.loaderId);
  });

  it("reports the field's own origin when document.domain lets the parent script it (I1)", async () => {
    await tb.page.goto(`${fx.origin("login")}/iframe-domain`);
    await tb.page.frames()[1]!.waitForSelector("#domain-password");
    // The parent really can reach into the child: the relaxation took effect.
    expect(
      await tb.page.evaluate(() =>
        Boolean(
          (document.getElementById("frame") as HTMLIFrameElement).contentDocument?.getElementById(
            "domain-password",
          ),
        ),
      ),
    ).toBe(true);
    const [box] = await describeGroup(await target("#domain-password", 1));
    expect(box?.info.origin).toBe(fx.origin("other"));
  });

  it("sees fields and submit buttons linked to the form by form= from outside it (review I1)", async () => {
    await tb.page.goto(`${fx.origin("login")}/offsite-outside-button`);
    const [username] = await describeGroup(await target("#username"));
    expect(username?.info.hasPasswordInScope).toBe(true);
    expect(username?.info.formOrigins).toContain(fx.origin("evil"));
    const [password] = await describeGroup(await target("#password"));
    expect(password?.info.formOrigins).toContain(fx.origin("evil"));
  });

  it("treats invisible password decoys and invisible fields as hidden (M3)", async () => {
    await tb.page.goto(`${fx.origin("login")}/hidden-decoys`);
    expect((await describeGroup(await target("#user")))[0]?.info.hasPasswordInScope).toBe(false);
    expect((await describeGroup(await target("#ghost")))[0]?.info.visible).toBe(false);
  });

  it("disables the password's own reveal toggle but not an unrelated 'Show …' button (M6)", async () => {
    await tb.page.goto(`${fx.origin("login")}/show-details`);
    const [box] = await describeGroup(await target("#password"));
    expect(await disableRevealToggles(box!.node)).toBe(1);
    expect(await tb.page.isDisabled("#reveal")).toBe(true);
    expect(await tb.page.isEnabled("#details")).toBe(true);
  });
});
