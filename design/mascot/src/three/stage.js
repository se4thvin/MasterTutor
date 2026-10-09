// Soft studio for concept renders: key / fill / rim lights, room environment, soft VSM shadows and
// a contact-shadow blob. Exposes window.renderShot(spec) and window.countTriangles(id).
import {
  CanvasTexture,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  PCFSoftShadowMap,
  WebGLRenderer,
  Box3,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ACCESSORIES, attach } from "./accessories.js";
import { buildCharacter } from "./characters.js";
import { PROPS } from "./props.js";
import { setDetail } from "./shapes.js";

const SIZE = 720;
const canvas = document.querySelector("canvas");
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;

const key = new DirectionalLight("#fff3e6", 3.3);
key.position.set(-1.8, 3.8, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.radius = 10;
key.shadow.blurSamples = 24;
key.shadow.bias = -0.0004;
Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 12 });
const fill = new DirectionalLight("#dfe9ff", 0.22);
fill.position.set(3, 1.2, 2.4);
const rim = new DirectionalLight("#ffffff", 1.5);
rim.position.set(1.8, 2.8, -3.5);
const bounce = new HemisphereLight("#ffffff", "#c9a487", 0.32);
scene.add(key, fill, rim, bounce);

const ground = new Mesh(new PlaneGeometry(8, 8), new ShadowMaterial({ opacity: 0.16 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.22)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}
const blob = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.002;
blob.renderOrder = -1;
scene.add(blob);

const VIEW_YAW = { front: 0, threeQuarter: 35, side: 90, back: 180 };
let current = null;

function project(p, camera) {
  const v = p.clone().project(camera);
  return [(v.x + 1) / 2, (1 - v.y) / 2];
}

function frameCamera(spec, rig, content) {
  const top = rig.top;
  if (spec.frame === "turn" || spec.frame === "face") {
    const [cy, h] = spec.frame === "turn" ? [(top + 0.24) / 2 - 0.08, top + 0.34] : [rig.face.eyes.y - 0.03, 0.66];
    const cam = new OrthographicCamera(-h / 2, h / 2, h / 2, -h / 2, 0.1, 20);
    cam.position.set(0, cy, 6);
    cam.lookAt(0, cy, 0);
    return cam;
  }
  const box = spec.frame === "fixed" ? new Box3(new Vector3(-rig.halfW - 0.2, -0.05, -0.3), new Vector3(rig.halfW + 0.2, top + 0.22, 0.3)) : new Box3().setFromObject(content);
  box.min.y = Math.min(box.min.y, -0.05);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const cam = new PerspectiveCamera(22, 1, 0.1, 30);
  const extent = Math.max(size.x, size.y) * 1.14;
  const dist = extent / 2 / Math.tan((22 * Math.PI) / 360) + size.z / 2;
  const tilt = (9 * Math.PI) / 180;
  cam.position.set(center.x, center.y + dist * Math.sin(tilt), center.z + dist * Math.cos(tilt));
  cam.lookAt(center);
  return cam;
}

window.renderShot = (spec) => {
  if (current) scene.remove(current);
  setDetail("render");
  const accPose = (spec.acc ?? []).map((a) => ACCESSORIES[a].pose).find(Boolean);
  const rig = buildCharacter(spec.concept, { expr: spec.expr, pose: spec.pose ?? accPose ?? "rest" });
  attach(rig, spec.acc ?? []);
  const content = rig.root;
  for (const p of spec.props ?? []) {
    const prop = PROPS[p](rig);
    prop.traverse((o) => {
      o.castShadow = false;
    });
    content.add(prop);
  }
  rig.root.rotation.y = (VIEW_YAW[spec.view ?? "front"] * Math.PI) / 180;
  scene.add(content);
  current = content;
  content.updateMatrixWorld(true);
  const lifted = rig.root.position.y > 0;
  blob.scale.set(rig.halfW * 2.5 * (lifted ? 0.8 : 1), rig.halfW * 1.5 * (lifted ? 0.8 : 1), 1);
  blob.material.opacity = lifted ? 0.5 : 1;
  const camera = frameCamera(spec, rig, content);
  renderer.render(scene, camera);
  const world = (p) => rig.body.localToWorld(p.clone());
  const marks = {
    ground: project(new Vector3(0, 0, 0), camera),
    eyes: project(new Vector3(0, rig.face.eyes.y, 0), camera),
    top: project(new Vector3(0, rig.H, 0), camera),
    left: project(new Vector3(-rig.halfW, 0, 0), camera),
    right: project(new Vector3(rig.halfW, 0, 0), camera),
  };
  for (const [k, s] of Object.entries(rig.sockets)) marks[k] = project(world(s.p), camera);
  marks["hand.R"] = project(rig.arms.R.hand.getWorldPosition(new Vector3()), camera);
  marks["hand.L"] = project(rig.arms.L.hand.getWorldPosition(new Vector3()), camera);
  return { url: canvas.toDataURL("image/webp", 0.9), marks, H: rig.H, top: rig.top };
};

/** Low-poly ("app") build of the base character, facial features excluded (they become an atlas). */
window.countTriangles = (id) => {
  setDetail("app");
  const rig = buildCharacter(id, {});
  let tris = 0;
  let meshes = 0;
  const materials = new Set();
  rig.root.traverse((o) => {
    if (!o.isMesh || o.userData.face) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    materials.add(o.material.color.getHexString());
  });
  setDetail("render");
  return { tris: Math.round(tris), meshes, colors: materials.size };
};

window.ready = true;
