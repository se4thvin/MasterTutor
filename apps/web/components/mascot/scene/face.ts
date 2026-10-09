import { Color, Vector4, type MeshPhysicalMaterial } from "three";
import { clay, patchClay } from "./clay.ts";
import { COLORS, FACE, PAD, PAD_Z } from "./shape.ts";

/**
 * The face pad's material: clay, with eyes, mouth, brows and cheeks drawn as signed distance
 * fields in its fragment shader. Features are vector-crisp at any size (anti-aliased with
 * fwidth), cost no texture, and morph continuously: a blink is a lid closing, not a cell flip,
 * and expressions crossfade with the state blender. Ink is glossy (low roughness, full
 * clearcoat) so the eyes catch the studio light like the glossy beans of the concept renders.
 */
export interface FaceUniforms {
  /** open (1 open … 0 shut), happy, sleepy, focused */
  uEyes: { value: Vector4 };
  /** gaze x, gaze y (body units), oops, thinking */
  uGaze: { value: Vector4 };
  /** mouth open, blush, brow, screen glow */
  uMouth: { value: Vector4 };
}

const linear = (hex: string) => {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const f = (n: number) => n.toFixed(4);

const PARS = /* glsl */ `
uniform vec4 uEyes;
uniform vec4 uGaze;
uniform vec4 uMouth;
varying vec2 vFaceP;
varying float vFaceZ;
float pipInk = 0.0;
float pipEye = 0.0;
float pipShine = 0.0;

// Inigo Quilez's cheap ellipse distance: exact on the outline, which is all anti-aliasing needs.
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
// A stroke along y = a(1 - (x/w)^2) + s x + o sin(k x) for |x| <= w, with round ends.
float sdCurve(vec2 p, float w, float a, float s, float o, float k, float t) {
  float x = clamp(p.x, -w, w);
  float y = a * (1.0 - (x * x) / (w * w)) + s * x + o * sin(k * x);
  float dy = -2.0 * a * x / (w * w) + s + o * k * cos(k * x);
  float d = abs(p.y - y) / sqrt(1.0 + dy * dy);
  return (abs(p.x) <= w ? d : length(p - vec2(x, y))) - t;
}
float cover(float d, float aa) { return 1.0 - smoothstep(-aa, aa, d); }

// One eye at its centre: an open bean that a lid closes, morphing to the happy (^) or sleepy
// (u) arcs. Returns coverage; adds the two shine dots to pipShine.
float pipEyeShape(vec2 p, float aa) {
  float open = uEyes.x;
  float happy = uEyes.y;
  float sleepy = uEyes.z;
  float ry = ${f(FACE.eyes.ry)} * mix(1.0, 0.7, uEyes.w) * mix(1.0, 0.86, uGaze.z);
  vec2 r = vec2(${f(FACE.eyes.rx)} * (1.0 + 0.16 * (1.0 - open)), max(ry * open, 0.0058));
  vec2 q = p + vec2(0.0, (1.0 - open) * ry * 0.3);
  float dOpen = sdEllipse(q, r);
  float dHappy = sdCurve(p - vec2(0.0, -0.016), 0.046, 0.04, 0.0, 0.0, 0.0, 0.0085);
  float dSleepy = sdCurve(p - vec2(0.0, 0.002), 0.046, -0.024, 0.0, 0.0, 0.0, 0.0078);
  float wOpen = max(0.0, 1.0 - happy - sleepy);
  float d = (dOpen * wOpen + dHappy * happy + dSleepy * sleepy) / max(wOpen + happy + sleepy, 1e-3);
  vec2 s = r / vec2(${f(FACE.eyes.rx)}, ${f(FACE.eyes.ry)});
  float lit = wOpen * smoothstep(0.3, 0.7, open);
  float big = cover(length(q - vec2(-0.0118, 0.019) * s) - 0.0112 * min(s.y, 1.0), aa);
  float small = cover(length(q - vec2(0.0128, -0.017) * s) - 0.0052 * min(s.y, 1.0), aa);
  pipShine = max(pipShine, max(big, small) * lit);
  return cover(d, aa);
}

float pipBrow(vec2 p, float weight, float tilt, float aa) {
  if (weight <= 0.001) return 0.0;
  float d = sdCurve(p, 0.03, 0.009, tilt, 0.0, 0.0, 0.005 * sqrt(min(weight, 1.0)));
  return cover(d, aa) * min(weight, 1.0);
}
`;

const MAIN = /* glsl */ `
{
  vec2 fp = vFaceP;
  float aa = max(length(fwidth(fp)) * 0.7, 1e-5);
  float front = smoothstep(0.0, 0.02, vFaceZ);
  vec2 gaze = uGaze.xy;
  float eyes = 0.0;
  for (int side = -1; side <= 1; side += 2) {
    vec2 c = vec2(float(side) * ${f(FACE.eyes.dx)}, ${f(FACE.eyes.y)}) + gaze;
    eyes = max(eyes, pipEyeShape(fp - c, aa));
  }
  // Brows: both lift for "eyebrow up"; the right one arches for thinking; oops tilts them worried.
  float think = uGaze.w;
  float browY = ${f(FACE.eyes.y + FACE.eyes.ry * 1.55)};
  float brows = 0.0;
  brows = max(brows, pipBrow(fp - vec2(-${f(FACE.eyes.dx)}, browY) - gaze * 0.6, uMouth.z + uGaze.z, -0.25 * uGaze.z, aa));
  brows = max(brows, pipBrow(fp - vec2(${f(FACE.eyes.dx)}, browY + 0.012 * think) - gaze * 0.6, max(uMouth.z, think) + uGaze.z, 0.25 * uGaze.z + 0.14 * think, aa));

  // Mouth: a smile line that flattens and slides aside (thinking), wobbles (oops), shrinks to an
  // "o" (sleepy), or opens into a D with a tongue (happy).
  vec2 mp = fp - vec2(0.0, ${f(FACE.mouth.y)}) - gaze * 0.35;
  float focus = uEyes.w;
  float oops = uGaze.z;
  float w = mix(mix(0.03, 0.021, focus), 0.019, think);
  float a = mix(mix(-0.019, -0.012, focus), 0.0, think);
  a = mix(a, 0.004, oops);
  float sl = mix(0.0, 0.14, think);
  vec2 lp = mp - vec2(0.013 * think, mix(0.006, -0.002, think));
  float dLine = sdCurve(lp, w, a, sl, 0.0032 * oops, 285.0, 0.0056);
  float dDot = sdEllipse(mp, vec2(0.0075, 0.009));
  float dl = mix(dLine, dDot, uEyes.z);
  vec2 op = mp + vec2(0.0, 0.004);
  float dOpen = max(sdEllipse(op, vec2(0.031, 0.026)), op.y - 0.006);
  float mouthOpen = uMouth.x;
  float dm = mix(dl, dOpen, mouthOpen);
  float mouth = cover(dm, aa);
  float tongue = mouthOpen * cover(sdEllipse(op - vec2(0.0, -0.014), vec2(0.016, 0.0085)), aa) * cover(dOpen, aa);

  // Cheeks: soft-edged blush discs that grow a little when happy.
  vec2 cr = vec2(${f(FACE.cheeks.rx)}, ${f(FACE.cheeks.ry)}) * (1.0 + 0.12 * uEyes.y);
  float blush = 0.0;
  for (int side = -1; side <= 1; side += 2) {
    float d = sdEllipse(fp - vec2(float(side) * ${f(FACE.cheeks.dx)}, ${f(FACE.cheeks.y)}), cr);
    blush = max(blush, 1.0 - smoothstep(-aa * 3.0 - 0.004, aa * 3.0 + 0.004, d));
  }
  blush *= clamp(uMouth.y * 0.8, 0.0, 1.0);

  eyes *= front; brows *= front; mouth *= front; tongue *= front; blush *= front;
  pipShine *= front;
  vec3 col = diffuseColor.rgb;
  col = mix(col, ${linear(COLORS.cheek)}, blush);
  col = mix(col, ${linear(COLORS.eye)}, max(eyes, brows));
  col = mix(col, ${linear(COLORS.mouth)}, mouth);
  col = mix(col, ${linear(COLORS.tongue)}, tongue);
  col = mix(col, vec3(1.0), pipShine);
  diffuseColor.rgb = col;
  pipInk = max(max(eyes, brows), mouth);
  pipEye = eyes;
}
`;

export function faceMaterial(): MeshPhysicalMaterial & { userData: { face: FaceUniforms } } {
  const material = clay(COLORS.face, { gloss: 0.22, sheen: 0.5 });
  const uniforms: FaceUniforms = {
    uEyes: { value: new Vector4(1, 0, 0, 0) },
    uGaze: { value: new Vector4(0, 0, 0, 0) },
    uMouth: { value: new Vector4(0, 0.85, 0, 0) },
  };
  material.userData = { face: uniforms };
  material.onBeforeCompile = (shader) => {
    patchClay(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vFaceP;\nvarying float vFaceZ;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFaceP = position.xy * vec2(${f(PAD.rx)}, ${f(PAD.ry)}) + vec2(0.0, ${f(PAD.y)});
        vFaceZ = position.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${MAIN}`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(pipShine) * 0.85 + vec3(0.18, 0.42, 1.0) * uMouth.w * 0.16 * (1.0 - pipInk);`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
        material.roughness = mix(material.roughness, 0.22, pipInk);
        #ifdef USE_CLEARCOAT
          material.clearcoat = mix(material.clearcoat, 1.0, pipEye);
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.06, pipEye);
        #endif
        #ifdef USE_SHEEN
          material.sheenColor *= 1.0 - pipInk;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => "pip-face";
  return material as MeshPhysicalMaterial & { userData: { face: FaceUniforms } };
}

/** Pad placement (centre z), for the rig. */
export const PAD_CENTER: [number, number, number] = [0, PAD.y, PAD_Z];
