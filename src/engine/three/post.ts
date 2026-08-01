/**
 * Post-processing.
 *
 * After surface detail, this is the largest remaining gap between "3D shapes
 * with lights on them" and something that reads as photographed. Three
 * effects do most of the work:
 *
 * - **Ambient occlusion** darkens creases and contact points — where a wall
 *   meets the ground, under a car, inside a doorway. Direct lighting cannot
 *   produce it, and without it every object looks like it is hovering
 *   slightly. It is the single biggest "why does this look fake" fix.
 * - **Bloom** bleeds light from bright surfaces. Real camera optics and real
 *   eyes both do this; its absence is subtle but reads as flat.
 * - **Tone mapping and grading** map the raw linear render into something
 *   filmic instead of clipping bright colours to white.
 *
 * All of it is expensive — SSAO is a full extra depth+normal pass — so the
 * whole chain is gated on the quality tier and switched off entirely on low.
 * On low the game renders exactly as before, straight to the canvas, with no
 * composer in the path at all.
 */

import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { Vector2 } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'

export interface PostOptions {
  /** Screen-space ambient occlusion. The most expensive pass here. */
  ssao?: boolean
  /** Light bleed from bright surfaces. */
  bloom?: boolean
  /** Cheap post-AA. Worth it whenever MSAA is off. */
  fxaa?: boolean
  /** AO sampling radius, world units. */
  aoRadius?: number
  /** AO strength. Over ~1.5 it reads as dirt rather than shadow. */
  aoIntensity?: number
  bloomStrength?: number
  bloomThreshold?: number
}

/**
 * The composed render chain.
 *
 * Owns nothing about the scene — hand it a scene and camera and it renders
 * them. `enabled` is checked by the caller, which falls back to a plain
 * renderer.render when the chain is off.
 */
export class PostProcessing {
  readonly composer: EffectComposer

  #aoPass: GTAOPass | null = null
  #bloomPass: UnrealBloomPass | null = null
  #fxaaPass: ShaderPass | null = null

  readonly #renderer: WebGLRenderer
  #width = 1
  #height = 1

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    options: PostOptions = {},
  ) {
    this.#renderer = renderer
    this.composer = new EffectComposer(renderer)

    this.composer.addPass(new RenderPass(scene, camera))

    if (options.ssao) {
      // GTAO rather than the older SSAOPass.
      //
      // SSAOPass compares occluder depths against min/maxDistance expressed
      // as a fraction of the whole camera range. With a 0.5-340 range, a five
      // centimetre contact gap is ~0.00015 — below any workable threshold, so
      // every occluder was rejected and the AO buffer came out pure white
      // regardless of how the parameters were tuned. GTAO works in world
      // units and does not have that failure mode.
      const pass = new GTAOPass(scene, camera, 512, 512)
      pass.output = GTAOPass.OUTPUT.Default
      pass.updateGtaoMaterial({
        // World units. The scene is metre-scale: a car is ~4 long, so a
        // radius under a metre keeps AO as contact shading rather than
        // large-scale dirt.
        radius: options.aoRadius ?? 0.5,
        distanceExponent: 1,
        thickness: 1,
        scale: options.aoIntensity ?? 1,
        samples: 16,
      })
      this.#aoPass = pass
      this.composer.addPass(pass)
    }

    if (options.bloom) {
      // Threshold high enough that only genuinely bright things bloom —
      // headlights, the sun off paint, lit windows. A low threshold makes
      // the whole image hazy, which reads as a smeared lens, not sunlight.
      const pass = new UnrealBloomPass(
        new Vector2(1, 1),
        options.bloomStrength ?? 0.32,
        0.6,
        options.bloomThreshold ?? 0.88,
      )
      this.#bloomPass = pass
      this.composer.addPass(pass)
    }

    if (options.fxaa) {
      const pass = new ShaderPass(FXAAShader)
      this.#fxaaPass = pass
      this.composer.addPass(pass)
    }

    // OutputPass applies tone mapping and the output colour space. It has to
    // be last: everything before it works in linear space, and tone mapping
    // before a blur would give the wrong result.
    this.composer.addPass(new OutputPass())

    this.setSize(renderer.domElement.width, renderer.domElement.height)
  }

  /** Resize every pass. Must be called whenever the canvas resizes. */
  setSize(width: number, height: number): void {
    this.#width = Math.max(1, width)
    this.#height = Math.max(1, height)

    const ratio = this.#renderer.getPixelRatio()
    this.composer.setSize(this.#width, this.#height)

    this.#aoPass?.setSize(this.#width, this.#height)
    this.#bloomPass?.setSize(this.#width, this.#height)

    // FXAA works in texel units, so it needs the real backing-store size,
    // not the CSS size — get this wrong and the AA either does nothing or
    // smears the whole image.
    if (this.#fxaaPass) {
      const uniforms = this.#fxaaPass.material.uniforms as {
        resolution: { value: Vector2 }
      }
      uniforms.resolution.value.set(1 / (this.#width * ratio), 1 / (this.#height * ratio))
    }
  }

  render(): void {
    this.composer.render()
  }

  /** The bloom pass, exposed for tuning. Null when bloom is off. */
  get bloomPass(): UnrealBloomPass | null {
    return this.#bloomPass
  }

  /** The AO pass, exposed for tuning. Null when AO is off for this tier. */
  get aoPass(): GTAOPass | null {
    return this.#aoPass
  }

  dispose(): void {
    this.composer.dispose()
    this.#aoPass?.dispose()
    this.#bloomPass?.dispose()
    this.#fxaaPass?.dispose()
  }
}
