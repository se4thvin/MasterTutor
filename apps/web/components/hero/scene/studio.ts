import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  type Material,
  type Texture,
  type WebGLRenderer,
} from "three";

export function isDarkColor(css: string): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(css).getHSL(hsl);
  return hsl.l < 0.5;
}

export function studioTones(dark: boolean): { wall: number; floor: number } {
  return dark ? { wall: 0.16, floor: 0.04 } : { wall: 0.42, floor: 0.1 };
}

/** Theme colours the scene mirrors: the body background and the tint, signal and hero tokens. */
export function readSceneTokens(): {
  bg: string;
  tint: string;
  signal: string;
  aqua: string;
  bondi: string;
} {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    tint: v("--tint"),
    signal: v("--signal"),
    aqua: v("--hero-aqua-deep"),
    bondi: v("--hero-bondi"),
  };
}

/** Code-built studio environment (no HDR download), re-tinted for dark mode. */
export function buildStudio(renderer: WebGLRenderer, bgCss: string): Texture {
  const tones = studioTones(isDarkColor(bgCss));
  const grey = (v: number) => new Color(v, v, v);
  const room = new Scene();
  room.add(
    new Mesh(
      new BoxGeometry(12, 12, 12),
      new MeshBasicMaterial({ color: grey(tones.wall), side: BackSide }),
    ),
  );
  const floor = new Mesh(
    new PlaneGeometry(12, 12),
    new MeshBasicMaterial({ color: grey(tones.floor) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5.9;
  room.add(floor);
  const panel = (
    w: number,
    h: number,
    v: number,
    x: number,
    y: number,
    z: number,
    tint?: string,
  ) => {
    const color = tint ? new Color(tint).multiplyScalar(v) : grey(v);
    const mesh = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ color, side: DoubleSide }),
    );
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel(9, 3, 7, 0, 5.8, 0.6);
  panel(1.4, 8, 5, -5.8, 0.6, 1.8);
  panel(1.4, 8, 2.6, 5.8, 0.6, 1.2);
  panel(6, 3, 2, 0, 0.4, 5.8);
  panel(4, 1.2, 4, 2.5, 2.6, -5.8, readSceneTokens().aqua);
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.035).texture;
  room.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as Material).dispose();
    }
  });
  pmrem.dispose();
  return texture;
}
