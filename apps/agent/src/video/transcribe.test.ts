import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ControlGuard } from "../browser/guard.ts";
import { StepCollector } from "../loop/step-collector.ts";
import { fakeParec } from "../testing/fake-parec.ts";
import { testLog } from "../testing/tool-context.ts";
import { pageVideoPlay, pageVideoState } from "./page/player.ts";
import { transcribeVideo } from "./transcribe.ts";

const audioDirs = async () =>
  (await readdir(tmpdir())).filter((name) => name.startsWith("mt-audio-")).length;

/** A player that plays for 0.8 s of wall time, or refuses to play. */
function fakeWorld(options: { plays: boolean }) {
  const started = Date.now();
  return {
    call: async (fn: unknown) => {
      if (fn === pageVideoPlay) return options.plays;
      if (fn === pageVideoState) {
        const t = (Date.now() - started) / 1_000;
        return {
          found: true,
          duration: 2,
          currentTime: t,
          paused: false,
          muted: false,
          ended: t >= 0.8,
          rect: null,
        };
      }
      return true;
    },
  } as never;
}

describe("transcribeVideo (spec §8 transcribe)", () => {
  it("offsets chunk times absolutely and deletes each chunk once transcribed (D6)", async () => {
    const used: string[] = [];
    const step = new StepCollector();
    const session = { guard: new ControlGuard() } as never;
    const out = await transcribeVideo(
      {
        transcriber: {
          transcribe: async (file) => {
            used.push(file);
            const index = Number(/chunk-(\d{3})/.exec(file)![1]);
            return [{ start: 0.1, end: 0.2, text: `chunk ${index}` }];
          },
        },
        parecPath: await fakeParec(),
        chunkSeconds: 1,
        pulseServer: async () => "tcp:127.0.0.1:4713",
      },
      { session, step, signal: new AbortController().signal, slotName: "browser-1" },
      fakeWorld({ plays: true }),
      { start: 30, end: 31 },
    );
    expect(out.seconds).toBe(1);
    expect(out.segments.length).toBeGreaterThan(0);
    for (const segment of out.segments) expect(segment.start).toBeGreaterThanOrEqual(30);
    expect(out.segments[0]!.start).toBeLessThan(30.5);
    expect(used.length).toBeGreaterThan(1);
    for (const file of used) expect(existsSync(file)).toBe(false);
    await step.afterCommitted(testLog);
  });

  it("removes the audio directory when playback is blocked", async () => {
    const before = await audioDirs();
    await expect(
      transcribeVideo(
        {
          transcriber: { transcribe: async () => [] },
          parecPath: await fakeParec(),
          chunkSeconds: 1,
          pulseServer: async () => "tcp:127.0.0.1:4713",
        },
        {
          session: { guard: new ControlGuard() } as never,
          step: new StepCollector(),
          signal: new AbortController().signal,
          slotName: "browser-1",
        },
        fakeWorld({ plays: false }),
        { start: 0, end: 1 },
      ),
    ).rejects.toMatchObject({ code: "playback_blocked" });
    expect(await audioDirs()).toBe(before);
  });

  it("refuses with audio_unavailable when the slot's audio cannot be recorded", async () => {
    const before = await audioDirs();
    let played = false;
    const world = {
      call: async (fn: unknown) => {
        if (fn === pageVideoPlay) played = true;
        return true;
      },
    } as never;
    await expect(
      transcribeVideo(
        {
          transcriber: { transcribe: async () => [] },
          parecPath: "/nonexistent/parec",
          pulseServer: async () => "tcp:127.0.0.1:4713",
        },
        {
          session: { guard: new ControlGuard() } as never,
          step: new StepCollector(),
          signal: new AbortController().signal,
          slotName: "browser-1",
        },
        world,
        { start: 0, end: 1 },
      ),
    ).rejects.toMatchObject({ code: "audio_unavailable" });
    expect(played).toBe(false);
    expect(await audioDirs()).toBe(before);
  });
});
