/**
 * Windows on buildings, drawn in the shader.
 *
 * Flat coloured boxes are the single biggest thing separating "toy blocks"
 * from "a city", and windows fix it. They are generated analytically in the
 * fragment shader rather than from a texture, which matters here because the
 * buildings are drawn with `InstancedMesh`: every instance shares one
 * geometry and one material, so there is no per-building UV scale to bake a
 * texture against. Deriving the pattern from object-space position multiplied
 * by the instance's own scale gives every building correctly-sized windows
 * regardless of how tall or wide it is, at zero texture cost.
 *
 * Ground floors get taller shopfront glazing, and the top of each building is
 * left blank for a parapet — both are cheap cues that read as architecture
 * rather than as a repeating pattern.
 */

import type { Material } from 'three'

export interface FacadeOptions {
  /** Horizontal window pitch, world units. */
  spacingX?: number
  /** Storey height, world units. */
  storeyHeight?: number
  /** Daytime glass colour. */
  glass?: [number, number, number]
  /** How strongly the glass colour replaces the wall colour, 0..1. */
  strength?: number
}

/**
 * Patch a standard material so it draws windows.
 *
 * Uses `onBeforeCompile`, so the material keeps all of Three's lighting,
 * shadow and fog handling — only the diffuse colour is modified.
 */
export function applyFacadeWindows(material: Material, options: FacadeOptions = {}): void {
  const spacingX = options.spacingX ?? 1.15
  const storeyHeight = options.storeyHeight ?? 1.15
  const glass = options.glass ?? [0.16, 0.22, 0.3]
  const strength = options.strength ?? 0.9

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacadeLocal;
        varying vec3 vFacadeNormal;
        varying vec3 vFacadeScale;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vFacadeNormal = objectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vFacadeLocal = position;
        // Recover this instance's scale from the columns of its matrix, so
        // the window grid is sized in world units rather than in the unit
        // cube the geometry was authored in.
        #ifdef USE_INSTANCING
          vFacadeScale = vec3(
            length(instanceMatrix[0].xyz),
            length(instanceMatrix[1].xyz),
            length(instanceMatrix[2].xyz)
          );
        #else
          vFacadeScale = vec3(1.0);
        #endif`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacadeLocal;
        varying vec3 vFacadeNormal;
        varying vec3 vFacadeScale;

        // Cheap 2D hash, used to give each window pane its own character.
        float facadeHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = abs(normalize(vFacadeNormal));
          vec3 worldPos = vFacadeLocal * vFacadeScale;

          // Roofs and the rounded corner bevels get no windows: a window
          // wrapping around a corner instantly reads as a texture bug.
          float sideness = max(n.x, n.z);
          if (sideness > 0.7) {
            // Pick whichever wall this fragment faces. The second component
            // keeps the two faces from sharing a hash, so opposite walls do
            // not have identical window patterns.
            bool facingX = n.x > n.z;
            vec2 uv = facingX ? vec2(worldPos.z, worldPos.y) : vec2(worldPos.x, worldPos.y);
            float faceSalt = facingX ? 17.3 : 61.7;

            // Height measured from the base of the building.
            float height = worldPos.y + vFacadeScale.y * 0.5;

            float storey = ${storeyHeight.toFixed(4)};
            float spacing = ${spacingX.toFixed(4)};

            // Leave a parapet at the top and a plinth at the very bottom.
            float topLimit = vFacadeScale.y - 0.55;
            float inBody = step(0.35, height) * step(height, topLimit);

            // The ground floor is one taller storey of shopfront glazing.
            float isGround = step(height, storey * 1.05);
            float pitchY = mix(storey, storey * 1.35, isGround);
            float fillY = mix(0.5, 0.72, isGround);

            vec2 cell = vec2(uv.x / spacing, height / pitchY);
            vec2 g = fract(cell);
            vec2 cellId = floor(cell);

            float halfX = 0.34;
            float halfY = fillY * 0.5;
            float inWindow =
              step(0.5 - halfX, g.x) * step(g.x, 0.5 + halfX) *
              step(0.5 - halfY, g.y) * step(g.y, 0.5 + halfY);
            inWindow *= inBody;

            // A darker recessed reveal around each pane gives the wall depth
            // without any extra geometry.
            float halfXr = halfX + 0.07;
            float halfYr = halfY + 0.09;
            float inReveal =
              step(0.5 - halfXr, g.x) * step(g.x, 0.5 + halfXr) *
              step(0.5 - halfYr, g.y) * step(g.y, 0.5 + halfYr);
            inReveal = clamp(inReveal - inWindow, 0.0, 1.0) * inBody;

            // Mullions: a cross of frame through each pane. A single flat
            // rectangle reads as a hole; divided glazing reads as a window.
            float barX = 1.0 - step(0.012, abs(g.x - 0.5));
            float barY = 1.0 - step(0.016, abs(g.y - 0.5));
            float inBar = clamp(barX + barY, 0.0, 1.0) * inWindow;

            // A slim band marking each floor slab.
            float band = (1.0 - step(0.045, g.y)) * inBody * (1.0 - inWindow);

            // Per-pane variation: some rooms brighter, some darker, a few with
            // a warm light on. Identical panes across a whole tower is the
            // clearest possible tell that a facade is procedural.
            float r = facadeHash(cellId + faceSalt);
            vec3 glassBase = vec3(${glass[0]}, ${glass[1]}, ${glass[2]});
            vec3 pane = glassBase * (0.72 + r * 0.75);
            // Roughly one pane in nine is lit from inside.
            float lit = step(0.89, r);
            pane = mix(pane, vec3(1.0, 0.86, 0.55), lit * 0.75);

            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, inReveal);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.86, band);
            diffuseColor.rgb = mix(diffuseColor.rgb, pane, inWindow * ${strength.toFixed(3)});
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.06, inBar);
          }
        }`,
      )
  }

  // Materials are cached by program; a distinct key stops Three reusing an
  // unpatched program compiled from the same base material type.
  material.customProgramCacheKey = () => `facade-${spacingX}-${storeyHeight}-${strength}`
}
