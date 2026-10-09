import type { RunStatus } from "@mastertutor/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIP_TIMING as T,
  createPipMachine,
  runPipState,
  type PipMachineOptions,
} from "./pip-machine.ts";
import type { PipState } from "./pip-types.ts";

let seen: PipState[];
const machines: { dispose(): void }[] = [];
function machine(options: Partial<PipMachineOptions> = {}) {
  seen = [];
  const m = createPipMachine({ onChange: (s) => seen.push(s), ...options });
  machines.push(m);
  return m;
}
const advance = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() =>
  vi.useFakeTimers({ now: 0, toFake: ["setTimeout", "clearTimeout", "Date", "performance"] }),
);
afterEach(() => {
  for (const m of machines.splice(0)) m.dispose();
  vi.useRealTimers();
});

describe("runPipState: run status → Pip", () => {
  it.each<[RunStatus, boolean, PipState]>([
    ["queued", false, "idle"],
    ["running", false, "working"],
    ["running", true, "reading"],
    ["waiting", false, "waiting"],
    ["sleeping", false, "dozing"],
    ["completed", false, "idle"],
    ["failed", false, "oops"],
    ["cancelled", false, "idle"],
  ])("%s (capturing %s) → %s", (status, capturing, state) => {
    expect(runPipState(status, capturing)).toBe(state);
  });

  it("only a running run reads: capturing never masks waiting or a failure", () => {
    expect(runPipState("waiting", true)).toBe("waiting");
    expect(runPipState("failed", true)).toBe("oops");
  });
});

describe("New task: arrival, typing, pause, start", () => {
  it("starts idle and reports nothing until something changes", () => {
    const m = machine();
    expect(m.state).toBe("idle");
    expect(seen).toEqual([]);
  });

  it("waves on arrival, then settles to idle", () => {
    const m = machine();
    m.send({ type: "arrive" });
    expect(m.state).toBe("waving");
    advance(T.waveMs - 1);
    expect(m.state).toBe("waving");
    advance(1);
    expect(seen).toEqual(["waving", "idle"]);
  });

  it("is attentive while typing, thinks after a pause, then goes idle", () => {
    const m = machine();
    m.send({ type: "type" });
    expect(m.state).toBe("attentive");
    // Keystrokes inside the pause window keep it attentive.
    for (let i = 0; i < 5; i++) {
      advance(T.thinkAfterMs - 1);
      m.send({ type: "type" });
    }
    expect(seen).toEqual(["attentive"]);
    advance(T.thinkAfterMs);
    expect(m.state).toBe("thinking");
    advance(T.thinkMs - 1);
    expect(m.state).toBe("thinking");
    advance(1);
    expect(seen).toEqual(["attentive", "thinking", "idle"]);
  });

  it("typing again while thinking goes straight back to attentive", () => {
    const m = machine();
    m.send({ type: "type" });
    advance(T.thinkAfterMs);
    m.send({ type: "type" });
    advance(T.minDwellMs);
    expect(m.state).toBe("attentive");
    advance(T.thinkMs);
    expect(m.state).toBe("thinking");
  });

  it("typing cuts the arrival wave short", () => {
    const m = machine();
    m.send({ type: "arrive" });
    advance(T.minDwellMs);
    m.send({ type: "type" });
    expect(m.state).toBe("attentive");
  });

  it("celebrates on Start, then works, and ignores typing and dozing once started", () => {
    const m = machine({ doze: true });
    m.send({ type: "type" });
    advance(T.minDwellMs);
    m.send({ type: "start" });
    expect(m.state).toBe("celebrating");
    advance(T.celebrateMs);
    expect(m.state).toBe("working");
    m.send({ type: "type" });
    advance(T.dozeAfterMs * 2);
    expect(m.state).toBe("working");
    expect(seen).toEqual(["attentive", "celebrating", "working"]);
  });

  it("a failed start says oops, then is idle and usable again", () => {
    const m = machine();
    m.send({ type: "start" });
    advance(T.minDwellMs);
    m.send({ type: "startFailed" });
    expect(m.state).toBe("oops");
    advance(T.oopsMs);
    expect(m.state).toBe("idle");
    advance(T.minDwellMs);
    m.send({ type: "type" });
    expect(m.state).toBe("attentive");
  });
});

describe("dozing", () => {
  it("dozes after dozeAfterMs without input, and any input wakes it", () => {
    const m = machine({ doze: true });
    advance(T.dozeAfterMs - 1);
    expect(m.state).toBe("idle");
    advance(1);
    expect(m.state).toBe("dozing");
    advance(T.minDwellMs);
    m.send({ type: "activity" });
    expect(m.state).toBe("idle");
    advance(T.dozeAfterMs);
    expect(m.state).toBe("dozing");
  });

  it("input pushes the doze back by a full period", () => {
    const m = machine({ doze: true });
    advance(T.dozeAfterMs / 2);
    m.send({ type: "activity" });
    advance(T.dozeAfterMs - 1);
    expect(m.state).toBe("idle");
    advance(1);
    expect(m.state).toBe("dozing");
  });

  it("never dozes without the doze option (run view and empty states)", () => {
    const m = machine();
    advance(T.dozeAfterMs * 3);
    expect(m.state).toBe("idle");
  });

  it("typing wakes it straight into attentive", () => {
    const m = machine({ doze: true });
    advance(T.dozeAfterMs + T.minDwellMs);
    m.send({ type: "type" });
    expect(m.state).toBe("attentive");
  });
});

describe("poke", () => {
  it("waves, then returns to what it was doing", () => {
    const m = machine();
    m.send({ type: "run", status: "running", capturing: false });
    advance(T.minDwellMs);
    m.send({ type: "poke" });
    expect(m.state).toBe("waving");
    advance(T.pokeMs);
    expect(m.state).toBe("working");
  });

  it("wakes a dozing Pip", () => {
    const m = machine({ doze: true });
    advance(T.dozeAfterMs + T.minDwellMs);
    m.send({ type: "poke" });
    expect(m.state).toBe("waving");
    advance(T.pokeMs);
    expect(m.state).toBe("idle");
  });

  it("never cuts a celebration short", () => {
    const m = machine();
    m.send({ type: "start" });
    m.send({ type: "poke" });
    expect(m.state).toBe("celebrating");
  });
});

describe("run view", () => {
  it("mirrors the run status", () => {
    const m = machine();
    const run = (status: RunStatus, capturing = false) => {
      m.send({ type: "run", status, capturing });
      advance(T.minDwellMs);
      return m.state;
    };
    expect(run("queued")).toBe("idle");
    expect(run("running")).toBe("working");
    expect(run("running", true)).toBe("reading");
    expect(run("waiting")).toBe("waiting");
    expect(run("sleeping")).toBe("dozing");
    expect(run("running")).toBe("working");
    expect(run("failed")).toBe("oops");
  });

  it("celebrates a run that completes while watched, then is idle", () => {
    const m = machine();
    m.send({ type: "run", status: "running", capturing: false });
    advance(T.minDwellMs);
    m.send({ type: "run", status: "completed", capturing: false });
    expect(m.state).toBe("celebrating");
    advance(T.runCelebrateMs - 1);
    expect(m.state).toBe("celebrating");
    advance(1);
    expect(seen).toEqual(["working", "celebrating", "idle"]);
  });

  it("an already completed run opens idle, without a celebration", () => {
    const m = machine();
    m.send({ type: "run", status: "completed", capturing: false });
    advance(T.runCelebrateMs);
    expect(seen).toEqual([]);
    expect(m.state).toBe("idle");
  });

  it("a repeated status does not celebrate twice", () => {
    const m = machine();
    m.send({ type: "run", status: "running", capturing: false });
    m.send({ type: "run", status: "completed", capturing: false });
    advance(T.runCelebrateMs);
    m.send({ type: "run", status: "completed", capturing: false });
    expect(m.state).toBe("idle");
  });
});

describe("debounce: a state shows for at least minDwellMs", () => {
  it("a flapping status shows only where it settled", () => {
    const m = machine();
    m.send({ type: "run", status: "running", capturing: false });
    expect(seen).toEqual(["working"]);
    m.send({ type: "run", status: "running", capturing: true });
    m.send({ type: "run", status: "waiting", capturing: false });
    m.send({ type: "run", status: "running", capturing: true });
    expect(seen).toEqual(["working"]);
    advance(T.minDwellMs - 1);
    expect(seen).toEqual(["working"]);
    advance(1);
    expect(seen).toEqual(["working", "reading"]);
  });

  it("a flap that returns to the shown state never reports a change", () => {
    const m = machine();
    m.send({ type: "run", status: "running", capturing: false });
    m.send({ type: "run", status: "waiting", capturing: false });
    m.send({ type: "run", status: "running", capturing: false });
    advance(T.minDwellMs * 2);
    expect(seen).toEqual(["working"]);
  });

  it("never stalls on a wall clock that stands still (a frozen test clock)", () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const m = machine({ doze: true });
    m.send({ type: "arrive" });
    advance(T.waveMs);
    expect(m.state).toBe("idle");
    advance(T.dozeAfterMs);
    expect(m.state).toBe("dozing");
    vi.restoreAllMocks();
  });

  it("dispose cancels every timer", () => {
    const m = machine({ doze: true });
    m.send({ type: "arrive" });
    m.send({ type: "type" });
    m.dispose();
    advance(T.dozeAfterMs * 2);
    expect(seen).toEqual(["waving"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
