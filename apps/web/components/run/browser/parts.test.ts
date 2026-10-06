import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement as h, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/toast/toast-provider.tsx";
import { recordedDetail, recordedSteps } from "@/lib/fixtures/run-recording.ts";
import { initRunModel } from "../model/run-model.ts";
import { Banners } from "./banners.tsx";
import { Caption } from "./caption.tsx";
import { FullscreenButton } from "./fullscreen-button.tsx";
import { HandBackSheet } from "./hand-back-sheet.tsx";
import { LiveFrame } from "./live-frame.tsx";
import { OriginPill, StatePill } from "./origin-pill.tsx";
import { StepCallout } from "./step-callout.tsx";

/** Server-renders inside the providers the run view has. */
const html = (node: ReactElement) =>
  renderToStaticMarkup(
    h(QueryClientProvider, { client: new QueryClient() }, h(ToastProvider, null, node)),
  );
const noop = () => undefined;
const model = () => initRunModel(recordedDetail(), recordedSteps());

describe("OriginPill (S6, S7)", () => {
  it("shows the host whole and the path cleaned, each isolated in <bdi>", () => {
    const url = `https://learn.example.edu/${"‮".repeat(3)}${"p".repeat(400)}`;
    const out = html(h(OriginPill, { url, secure: false }));
    expect(out).toContain('<bdi class="run-host">learn.example.edu</bdi>');
    expect(out).not.toContain("‮");
    const path = /<bdi class="run-path">([^<]*)<\/bdi>/.exec(out)?.[1] ?? "";
    expect([...path].length).toBeLessThanOrEqual(200);
  });

  it("reads New tab without a URL and offers the Filled securely note only when secure", () => {
    expect(html(h(OriginPill, { url: null, secure: false }))).toContain("New tab");
    const url = "https://learn.example.edu";
    expect(html(h(OriginPill, { url, secure: true }))).toContain('aria-label="Filled securely"');
    expect(html(h(OriginPill, { url, secure: false }))).not.toContain("Filled securely");
  });

  it("states its tone and pulse for CSS", () => {
    expect(html(h(StatePill, { label: "Live", tone: "signal", pulse: true }))).toContain(
      'data-tone="signal" data-pulse="true"',
    );
  });
});

describe("Caption and StepCallout (S6)", () => {
  it("isolates the caption in <bdi> inside a polite live region", () => {
    const out = html(h(Caption, { text: "Ticking the box", step: "Step 6", tone: "acting" }));
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("<bdi>Ticking the box</bdi>");
    expect(out).toContain("Step 6");
  });

  it("keeps the callout decorative, with its text isolated", () => {
    const out = html(
      h(StepCallout, {
        text: "Honor Code",
        number: 6,
        target: { x: 100, y: 80 },
        box: { width: 640, height: 400 },
      }),
    );
    expect(out).toMatch(/class="run-callouts" aria-hidden="true"/);
    expect(out).toContain("<bdi>Honor Code</bdi>");
  });
});

describe("Banners", () => {
  type Props = ComponentProps<typeof Banners>;
  const banners = (state: Props["state"], live: Props["live"] = "live") =>
    html(
      h(Banners, {
        state,
        model: model(),
        replayLabel: "Step 3",
        live,
        onHandBack: noop,
        onResume: noop,
        onJumpLive: noop,
      }),
    );
  /** The text of each banner that is shown. */
  const shown = (out: string) =>
    [...out.matchAll(/data-show="true"[^>]*>(.*?)<\/div>/gs)].map((m) => m[1] ?? "");

  it("shows only the banner for the current state; the others are hidden", () => {
    const visible = shown(banners("control"));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toContain("in control");
  });

  it("says when the live view is open in another tab (L1), but not while you are in control", () => {
    expect(shown(banners("live", "in_use")).join()).toContain("Open in another tab");
    expect(shown(banners("control", "in_use")).join()).not.toContain("Open in another tab");
  });

  it("shows the one spinner only while reconnecting", () => {
    expect(banners("reconnecting")).toContain("Reconnecting to the browser…");
    expect(banners("live")).not.toContain("Reconnecting");
  });
});

describe("LiveFrame and FullscreenButton", () => {
  it("renders no frame until runs.openLive has answered", () => {
    const frame = h(LiveFrame, {
      runId: "x",
      slotName: "browser-1",
      epoch: 0,
      title: "Remote browser",
      interactive: false,
      onStatus: noop,
    });
    expect(html(frame)).not.toContain("<iframe");
    expect(html(frame)).not.toContain("run-live");
  });

  it("names the full-screen control and its state", () => {
    const out = html(h(FullscreenButton, { target: { current: null } }));
    expect(out).toContain('aria-label="Full screen"');
    expect(out).toContain('aria-pressed="false"');
  });
});

describe("HandBackSheet", () => {
  it("renders nothing while closed", () => {
    const out = html(h(HandBackSheet, { open: false, onOpenChange: noop, onHandBack: noop }));
    expect(out).not.toContain("Hand back to the agent");
  });
});
