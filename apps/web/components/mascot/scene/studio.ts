import {
  CanvasTexture,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  RGBAFormat,
  ShadowMaterial,
  type Texture,
  type WebGLRenderer,
} from "three";
import { DataUtils } from "three";

/**
 * Pip's studio: a tiny procedural environment (a 256×128 half-float equirect of soft boxes,
 * baked once into a 64 px PMREM; no download), a warm key that casts the soft shadow, a cool
 * fill, a rim that holds the silhouette on dark backgrounds, a shadow-catcher ground and a
 * contact-shadow blob texture.
 */

/** A soft box: direction (unit), angular radius (rad), radiance (linear RGB). */
interface SoftBox {
  dir: [number, number, number];
  size: number;
  rgb: [number, number, number];
}

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

const BOXES: SoftBox[] = [
  { dir: norm([-0.55, 0.75, 0.6]), size: 0.55, rgb: [5.2, 4.8, 4.3] }, // key softbox, upper left
  { dir: norm([0.9, 0.25, 0.45]), size: 0.5, rgb: [1.3, 1.5, 1.9] }, // cool fill, right
  { dir: norm([0.35, 0.5, -0.85]), size: 0.32, rgb: [3.2, 3.3, 3.5] }, // rim strip, behind
  { dir: norm([0, 1, 0]), size: 0.9, rgb: [1.4, 1.4, 1.45] }, // ceiling bounce
];

/** Radiance of the procedural studio in direction d (unit). */
function studioRadiance(d: [number, number, number]): [number, number, number] {
  // Base: a soft grey room, a little warmer toward the floor (bounce off a warm table).
  const up = d[1];
  const t = (up + 1) / 2;
  const out: [number, number, number] = [
    0.32 + 0.1 * t + (up < 0 ? 0.08 * -up : 0),
    0.31 + 0.11 * t + (up < 0 ? 0.04 * -up : 0),
    0.3 + 0.14 * t,
  ];
  for (const box of BOXES) {
    const cos = d[0] * box.dir[0] + d[1] * box.dir[1] + d[2] * box.dir[2];
    const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
    // A soft-edged disc: full inside, smooth falloff over 40% of its radius.
    const edge = 1 - Math.min(1, Math.max(0, (angle - box.size * 0.6) / (box.size * 0.4)));
    const k = edge * edge * (3 - 2 * edge);
    out[0] += box.rgb[0] * k;
    out[1] += box.rgb[1] * k;
    out[2] += box.rgb[2] * k;
  }
  return out;
}

const ENV_W = 256;
const ENV_H = 128;

function environmentTexture(): DataTexture {
  const data = new Uint16Array(ENV_W * ENV_H * 4);
  // three's equirect lookup: u = atan(d.z, d.x) / 2π + 0.5, v = asin(d.y) / π + 0.5; a
  // DataTexture's first row is v = 0.
  for (let y = 0; y < ENV_H; y++) {
    const lat = ((y + 0.5) / ENV_H - 0.5) * Math.PI;
    for (let x = 0; x < ENV_W; x++) {
      const lon = ((x + 0.5) / ENV_W - 0.5) * Math.PI * 2;
      const d: [number, number, number] = [
        Math.cos(lat) * Math.cos(lon),
        Math.sin(lat),
        Math.cos(lat) * Math.sin(lon),
      ];
      const [r, g, b] = studioRadiance(d);
      const i = (y * ENV_W + x) * 4;
      data[i] = DataUtils.toHalfFloat(r);
      data[i + 1] = DataUtils.toHalfFloat(g);
      data[i + 2] = DataUtils.toHalfFloat(b);
      data[i + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const texture = new DataTexture(data, ENV_W, ENV_H, RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Bakes the studio into a PMREM (cube size 64). The source texture is freed at once. */
export function bakeEnvironment(renderer: WebGLRenderer): Texture {
  const source = environmentTexture();
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();
  return target.texture;
}

export function studioLights(dark: boolean) {
  const key = new DirectionalLight("#fff1e2", 3.4);
  key.position.set(-1.7, 3.6, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.012;
  Object.assign(key.shadow.camera, {
    left: -1,
    right: 1,
    top: 1.6,
    bottom: -0.6,
    near: 1.5,
    far: 7,
  });
  key.target.position.set(0, 0.5, 0);
  const fill = new DirectionalLight("#dfe9ff", 0.35);
  fill.position.set(3, 1.2, 2.4);
  const rim = new DirectionalLight("#ffffff", dark ? 2.6 : 1.5);
  rim.position.set(1.8, 2.8, -3.5);
  return { key, fill, rim };
}

/** Receives only the key light's soft shadow; invisible elsewhere. */
export function shadowCatcher(): Mesh {
  const ground = new Mesh(new PlaneGeometry(4, 4), new ShadowMaterial({ opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

/** A soft radial contact shadow (64 px canvas), drawn under the feet and scaled with a hop. */
export function contactShadow(): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.5)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.2)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const blob = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.002;
  blob.renderOrder = -1;
  return blob;
}
