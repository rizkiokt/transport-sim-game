/**
 * The sky, and the environment map derived from it.
 *
 * Two jobs, both important for realism:
 *
 * 1. **A gradient sky** instead of a flat colour. Real sky is bright and pale
 *    at the horizon and deeper overhead, and that single gradient does more
 *    for "this is a place" than almost anything else on screen.
 *
 * 2. **An environment map** for reflections. Without one, a car's paint has
 *    only a single specular dot from the sun and reads as plastic. With even
 *    a crude sky/ground environment it picks up a bright sky reflection on
 *    upward faces and a darker ground bounce below, which is exactly what
 *    makes a surface look like painted metal.
 *
 * Both are generated at runtime from a canvas — no HDR files, nothing
 * fetched. The environment map is pre-filtered with `PMREMGenerator` so
 * rough surfaces blur it correctly rather than mirroring it.
 */

import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
  PMREMGenerator,
} from 'three'

export interface SkyOptions {
  /** Colour directly overhead. */
  zenith?: string
  /** Colour at the horizon — always paler than the zenith. */
  horizon?: string
  /** Ground colour below the horizon, which supplies the bounce light. */
  ground?: string
  /** Height of the generated texture. Small is fine; it gets blurred anyway. */
  size?: number
}

export interface SkyResult {
  /** Equirectangular texture suitable for `scene.background`. */
  background: Texture
  /** Pre-filtered cube map for `scene.environment`. */
  environment: Texture
  dispose(): void
}

/**
 * Build the sky gradient and its pre-filtered environment map.
 *
 * Must be called after the renderer exists, because pre-filtering runs on the
 * GPU.
 */
export function createSky(renderer: WebGLRenderer, options: SkyOptions = {}): SkyResult {
  const zenith = options.zenith ?? '#4a9fe0'
  const horizon = options.horizon ?? '#cfe9f7'
  const ground = options.ground ?? '#5f8f4e'
  const size = options.size ?? 256

  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('createSky: could not acquire a 2D context')

  // An equirectangular map runs from the zenith at v=0 to the nadir at v=1,
  // with the horizon exactly halfway.
  const gradient = ctx.createLinearGradient(0, 0, 0, size)
  gradient.addColorStop(0, zenith)
  gradient.addColorStop(0.42, zenith)
  gradient.addColorStop(0.5, horizon)
  // A hard-ish edge at the horizon; a soft one reads as fog, not ground.
  gradient.addColorStop(0.52, ground)
  gradient.addColorStop(1, ground)

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, size)

  const background = new CanvasTexture(canvas)
  background.mapping = EquirectangularReflectionMapping
  background.colorSpace = SRGBColorSpace
  background.minFilter = LinearFilter
  background.magFilter = LinearFilter
  background.needsUpdate = true

  const pmrem = new PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const target = pmrem.fromEquirectangular(background)
  pmrem.dispose()

  return {
    background,
    environment: target.texture,
    dispose(): void {
      background.dispose()
      target.dispose()
    },
  }
}
