import {
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three";

/**
 * Pip's clay: MeshPhysicalMaterial with sheen and a soft clearcoat, plus two cheap shader
 * additions that make it read as soft modelling clay rather than plastic:
 * - wrap lighting: a warm, faked subsurface glow that softens the terminator of every
 *   directional light (no transmission pass);
 * - analytic ambient occlusion from the height above the ground and a downward-facing normal:
 *   the underside and the feet darken, and lift off as Pip hops (no AO pass, no AO texture).
 */
type ShaderPatch = (shader: WebGLProgramParametersWithUniforms) => void;

const WORLD_VARYINGS = /* glsl */ `
varying vec3 vPipWorld;
varying vec3 vPipWorldNormal;
`;

const patchWorld: ShaderPatch = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${WORLD_VARYINGS}`)
    .replace(
      "#include <project_vertex>",
      /* glsl */ `#include <project_vertex>
      vec4 pipWorld = vec4(transformed, 1.0);
      vec3 pipNormal = objectNormal;
      #ifdef USE_INSTANCING
        pipWorld = instanceMatrix * pipWorld;
        pipNormal = mat3(instanceMatrix) * pipNormal;
      #endif
      vPipWorld = (modelMatrix * pipWorld).xyz;
      vPipWorldNormal = normalize(mat3(modelMatrix) * pipNormal);`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    `#include <common>\n${WORLD_VARYINGS}`,
  );
};

/** Wrap amount (0 = Lambert) and the warm colour light picks up as it scatters through clay. */
const WRAP = 0.45;
const SCATTER = new Color(1, 0.52, 0.38).multiplyScalar(0.32);

export const patchClay: ShaderPatch = (shader) => {
  patchWorld(shader);
  const scatter = `vec3(${SCATTER.r.toFixed(3)}, ${SCATTER.g.toFixed(3)}, ${SCATTER.b.toFixed(3)})`;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <lights_fragment_end>",
      /* glsl */ `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
          float ndl = dot(normal, directionalLights[i].direction);
          float wrapped = max(0.0, (ndl + ${WRAP.toFixed(2)}) / ${(1 + WRAP).toFixed(2)}) - max(0.0, ndl);
          reflectedLight.directDiffuse += wrapped * directionalLights[i].color * ${scatter} * diffuseColor.rgb;
        }
      #endif`,
    )
    .replace(
      "#include <aomap_fragment>",
      /* glsl */ `#include <aomap_fragment>
      float pipGround = smoothstep(0.0, 0.34, vPipWorld.y);
      float pipDown = clamp(-vPipWorldNormal.y, 0.0, 1.0);
      float pipAO = 1.0 - (1.0 - pipGround) * (0.28 + 0.5 * pipDown);
      reflectedLight.indirectDiffuse *= pipAO;
      reflectedLight.indirectSpecular *= mix(1.0, pipAO, 0.7);
      reflectedLight.directDiffuse *= mix(1.0, pipAO, 0.3);`,
    );
};

interface ClayOptions {
  gloss?: number;
  rough?: number;
  sheen?: number;
}

/** Matte clay with a soft clearcoat and sheen (one compiled program for every clay colour). */
export function clay(hex: string, { gloss = 0.28, rough = 0.62, sheen = 0.6 }: ClayOptions = {}) {
  const color = new Color(hex);
  const material = new MeshPhysicalMaterial({
    color,
    roughness: rough,
    metalness: 0,
    clearcoat: gloss,
    clearcoatRoughness: 0.38,
    sheen,
    sheenRoughness: 0.5,
    sheenColor: color.clone().lerp(new Color("#ffffff"), 0.5),
    emissive: color.clone().lerp(new Color("#ff9a6a"), 0.4),
    emissiveIntensity: 0.035,
  });
  material.onBeforeCompile = patchClay;
  material.customProgramCacheKey = () => "pip-clay";
  return material;
}

/** Self-lit (a laptop screen, a glow): no lighting work at all. */
export function glow(hex: string, intensity = 1.4) {
  return new MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: intensity,
    roughness: 0.5,
  });
}
