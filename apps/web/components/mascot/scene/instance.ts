import { Quaternion, Vector3 } from "three";
import { springs } from "@/lib/motion-tokens.ts";
import { createSpring, stepSprings } from "@/lib/spring.ts";
import type { PipAccessory, PipState } from "../pip-types.ts";
import { blinkClosure, createBlinker, type Blinker } from "../motion/blink.ts";
import {
  blendPose,
  createBlender,
  setBlendTarget,
  stateAge,
  stepBlender,
  type Blender,
} from "../motion/blender.ts";
import { LOOK_LIMITS, type Look } from "../motion/look.ts";
import { CONFETTI, PAGE_TURN_S, type Pose, type PoseContext } from "../motion/poses.ts";
import { seeded, type Random } from "../motion/random.ts";
import { createSprout, kickSprout, stepSprout, type Sprout } from "../motion/sprout.ts";
import { ACCESSORIES } from "./accessories.ts";
import { BUBBLE_RADII, CLOUD_Y, placeConfetti, placeZzz } from "./props.ts";
import { createRig, disposeRig, type PipRig } from "./rig.ts";
import { CROWN_Y, EGG } from "./shape.ts";

/**
 * One Pip: its rig plus everything that moves it. Each frame the blender mixes the states'
 * procedural poses, the blink scheduler shuts the lids, the look springs turn the head, the
 * poke spring squashes the body, and the sprout's own simulation follows the crown.
 */

const easeOutBack = (x: number) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpDir = new Vector3();
const tmpQ = new Quaternion();
const leafTurn = new Quaternion();
const Z_AXIS = new Vector3(0, 0, 1);

/** Seconds a poke keeps Pip delighted. */
const POKE_JOY_S = 0.7;
/** Eye travel in body units at full gaze (±1). */
const GAZE = { x: 0.012, y: 0.01 } as const;

export class PipInstance {
  readonly rig: PipRig;
  private readonly blender: Blender;
  private readonly blinker: Blinker;
  private readonly sprout: Sprout;
  private readonly look = {
    yaw: createSpring(0, springs.pipLook),
    pitch: createSpring(0, springs.pipLook),
  };
  private readonly squash = createSpring(0, springs.pipSquash);
  private accessories: ReadonlySet<PipAccessory> = new Set();
  private pokedAt = -Infinity;
  private lastState: PipState;
  /** Poster captures keep the eyes open. */
  blinking = true;
  /** At compact size floating props (bubbles, Zs, confetti) are noise: the face carries the state. */
  private readonly compact: boolean;

  constructor(state: PipState, now: number, compact = false, rand: Random = Math.random) {
    this.compact = compact;
    this.rig = createRig();
    this.blender = createBlender(state, now);
    this.blinker = createBlinker(rand, now * 1000);
    this.lastState = state;
    this.rig.group.updateMatrixWorld(true);
    this.sprout = createSprout(this.rig.crown.matrixWorld.elements);
  }

  get state(): PipState {
    return this.blender.target;
  }

  setState(state: PipState, now: number): void {
    if (state === this.lastState) return;
    this.lastState = state;
    setBlendTarget(this.blender, state, now);
    // Perks the sprout when the party starts.
    if (state === "celebrating") kickSprout(this.sprout, [0, 0.9, 0.2]);
  }

  setAccessories(list: readonly PipAccessory[]): void {
    this.accessories = new Set(list);
  }

  poke(now: number): void {
    this.pokedAt = now;
    this.squash.v -= 2.2;
    kickSprout(this.sprout, [0.35, 0.8, 0.25]);
  }

  /** Advances motion to `now` (seconds) and poses the rig. `look` is the target head turn. */
  update(now: number, dt: number, look: Look): void {
    stepBlender(this.blender, dt);
    this.look.yaw.target = look.yaw;
    this.look.pitch.target = look.pitch;
    stepSprings([this.look.yaw, this.look.pitch, this.squash], dt);
    const held = this.held();
    const pose = blendPose(this.blender, now, { held } satisfies PoseContext);
    const joy = clamp01(1 - (now - this.pokedAt) / POKE_JOY_S);
    this.poseBody(pose);
    this.poseFace(pose, now, joy);
    this.poseItems(pose, now);
    this.rig.group.updateMatrixWorld(true);
    stepSprout(this.sprout, this.rig.crown.matrixWorld.elements, dt, {
      droop: pose.droop,
      sway: pose.sway,
      time: now,
    });
    this.poseSprout();
  }

  dispose(): void {
    disposeRig(this.rig);
  }

  private held(): PoseContext["held"] {
    for (const name of this.accessories) {
      const held = ACCESSORIES[name].held;
      if (held) return held;
    }
    return null;
  }

  private poseBody(pose: Pose): void {
    const { root, body, arms, shadow } = this.rig;
    const squash = pose.squash + this.squash.x * 0.06;
    root.position.y = pose.lift;
    root.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
    const breath = pose.breath;
    body.scale.set(1 - 0.008 * breath, 1 + 0.015 * breath, 1 - 0.008 * breath);
    const yaw = this.look.yaw.x * pose.lookGain;
    const pitch = this.look.pitch.x * pose.lookGain;
    body.rotation.set(pose.nod - pitch * 0.6, pose.turn + yaw, pose.lean, "YXZ");
    arms.L.rotation.set(pose.armLx, 0, -pose.armLz);
    arms.R.rotation.set(pose.armRx, 0, pose.armRz);
    // The contact shadow tightens and fades as Pip leaves the ground.
    const away = clamp01(pose.lift * 5);
    shadow.scale.set(EGG.radius * 2.35 * (1 - away * 0.3), EGG.radius * 1.5 * (1 - away * 0.3), 1);
    (shadow.material as { opacity: number }).opacity = 1 - away * 0.55;
  }

  private poseFace(pose: Pose, now: number, joy: number): void {
    const closure = this.blinking ? blinkClosure(this.blinker, now * 1000) : 0;
    let happy = Math.max(pose.happy, joy);
    let sleepy = pose.sleepy * (1 - joy);
    const sum = happy + sleepy;
    if (sum > 1) {
      happy /= sum;
      sleepy /= sum;
    }
    const open = 1 - closure * clamp01(pose.blinks);
    const yawShare = (this.look.yaw.x * pose.lookGain) / LOOK_LIMITS.yaw;
    const pitchShare = (this.look.pitch.x * pose.lookGain) / LOOK_LIMITS.pitch;
    const { uEyes, uGaze, uMouth } = this.rig.face;
    uEyes.value.set(open, happy, sleepy, pose.focused * (1 - joy));
    uGaze.value.set(
      (pose.gazeX + yawShare * 0.7) * GAZE.x,
      (pose.gazeY + pitchShare * 0.7) * GAZE.y,
      pose.oops * (1 - joy),
      pose.thinking * (1 - joy),
    );
    uMouth.value.set(
      Math.max(pose.mouthOpen, joy),
      pose.blush + joy * 0.3,
      pose.brow,
      pose.glow * pose.laptop,
    );
  }

  private show(name: PipAccessory, weight: number): void {
    const item = this.rig.accessories[name];
    item.visible = weight > 0.002;
    if (item.visible) item.scale.setScalar(Math.max(0.0001, easeOutBack(weight)));
  }

  private poseItems(pose: Pose, now: number): void {
    const has = (name: PipAccessory) => (this.accessories.has(name) ? 1 : 0);
    const laptop = Math.max(has("laptop") * (1 - pose.book), pose.laptop);
    const book = Math.max(has("book") * (1 - pose.laptop), pose.book);
    const hat = Math.max(has("party-hat"), pose.partyHat);
    for (const name of ["glasses", "headphones", "bowtie"] as const) this.show(name, has(name));
    this.show("beret", has("beret") * (1 - pose.partyHat));
    this.show("laptop", laptop);
    this.show("book", book);
    this.show("party-hat", hat);
    if (this.rig.screen) this.rig.screen.emissiveIntensity = 0.55 + 0.6 * pose.glow;
    // A page turn nudges the book at the end of each read line.
    const sinceTurn = stateAge(this.blender, "reading", now) % PAGE_TURN_S;
    this.rig.accessories.book.rotation.z =
      pose.book > 0.5
        ? 0.06 * Math.sin(Math.PI * clamp01((sinceTurn - PAGE_TURN_S * 0.82) / 0.3))
        : 0;

    const crownTaken = Math.max(hat, has("beret"));
    this.rig.sprout.segments.forEach((s) => (s.visible = crownTaken < 0.5));
    this.rig.sprout.leaves.forEach((l) => (l.visible = crownTaken < 0.5));

    const { bubbles, zzz, sweat, confetti } = this.rig.props;
    const floating = this.compact ? 0 : 1;
    bubbles.visible = pose.bubbles * floating > 0.002;
    if (bubbles.visible) {
      // Three trail bubbles (unit spheres scaled to their radius), then the cloud.
      bubbles.children.forEach((child, i) => {
        const s = Math.max(0.0001, easeOutBack(clamp01(pose.bubbles * 4 - i)));
        child.scale.setScalar(s * (BUBBLE_RADII[i] ?? 1));
      });
      const cloud = bubbles.children[3]!;
      cloud.position.y = CLOUD_Y + 0.012 * Math.sin(now * 2.1);
      cloud.children
        .filter((c) => c.name === "dot")
        .forEach((dot, j) => {
          const pulse = Math.max(0, Math.sin(((now * 1000) / 1300) * Math.PI * 2 - j * 0.9));
          dot.scale.setScalar(0.016 * (0.75 + 0.45 * pulse));
        });
    }
    zzz.visible = pose.zzz * floating > 0.002;
    if (zzz.visible) placeZzz(zzz, now, pose.zzz);
    sweat.visible = pose.sweat > 0.002;
    if (sweat.visible) {
      sweat.scale.setScalar(Math.max(0.0001, easeOutBack(pose.sweat)));
      sweat.position.y = CROWN_Y - 0.12 - 0.025 * ((now * 0.45) % 1);
    }
    const party = this.blender.weights.celebrating;
    const age = (stateAge(this.blender, "celebrating", now) - CONFETTI.atS) % CONFETTI.everyS;
    placeConfetti(confetti, party > 0.3 && !this.compact ? age : -1, party);
  }

  private poseSprout(): void {
    const [p0, p1, p2] = this.sprout.points;
    const { segments, leaves } = this.rig.sprout;
    const place = (mesh: (typeof segments)[number], a: readonly number[], b: readonly number[]) => {
      tmpA.set(a[0]!, a[1]!, a[2]!);
      tmpB.set(b[0]!, b[1]!, b[2]!);
      mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      tmpDir.copy(tmpB).sub(tmpA).normalize();
      mesh.quaternion.setFromUnitVectors(UP, tmpDir);
    };
    place(segments[0], p0, p1);
    place(segments[1], p1, p2);
    tmpQ.copy(segments[1].quaternion);
    const spread = this.sprout.leafSpread;
    leaves.forEach((leaf, i) => {
      leaf.position.set(p2[0], p2[1], p2[2]);
      const angle = i === 0 ? -0.35 - spread : 0.3 + spread;
      leafTurn.setFromAxisAngle(Z_AXIS, angle);
      leaf.quaternion.copy(tmpQ).multiply(leafTurn);
    });
  }
}

/** A deterministic Pip for poster captures: same seed, no blinking. */
export function posterInstance(
  state: PipState,
  compact: boolean,
  accessories: readonly PipAccessory[],
): PipInstance {
  const pip = new PipInstance(state, 0, compact, seeded(5));
  pip.blinking = false;
  pip.setAccessories(accessories);
  return pip;
}
