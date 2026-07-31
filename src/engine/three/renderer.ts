/**
 * The WebGL renderer, its canvas sizing, and the quality tiers.
 *
 * Owns everything that has to react to the display rather than to gameplay:
 * device pixel ratio, resize, shadow quality, and the antialiasing/tone
 * mapping that make the picture look intentional rather than raw.
 *
 * The tier system is the same idea as the 2D build's: watch the frame rate
 * and quietly step quality down when a device struggles. On a 3D scene the
 * levers are different — shadow map size and pixel ratio dominate, not
 * particle counts.
 */

import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'

export type QualityTier = 'low' | 'medium' | 'high'

export interface RenderQualityProfile {
  /** Upper bound on device pixel ratio. The single biggest cost lever. */
  maxPixelRatio: number
  /** Shadow map resolution, or 0 to disable shadows entirely. */
  shadowMapSize: number
  /** Enable MSAA. Off on low-end; the cost is real and the gain subtle. */
  antialias: boolean
  /** How far the camera can see, in world units. Shorter = fewer draws. */
  drawDistance: number
  /**
   * Image-based lighting from the sky environment map. Off on low-end: it is
   * per-fragment work that a weak mobile GPU feels immediately.
   */
  environmentLighting: boolean
}

export const RENDER_PROFILES: Record<QualityTier, RenderQualityProfile> = {
  low: {
    maxPixelRatio: 1,
    shadowMapSize: 0,
    antialias: false,
    drawDistance: 190,
    environmentLighting: false,
  },
  medium: {
    maxPixelRatio: 1.4,
    shadowMapSize: 1024,
    antialias: false,
    drawDistance: 260,
    environmentLighting: true,
  },
  high: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    antialias: true,
    drawDistance: 340,
    environmentLighting: true,
  },
}

export interface RendererOptions {
  canvas: HTMLCanvasElement
  tier?: QualityTier
  /** Vertical field of view in degrees. */
  fov?: number
}

export class ThreeRenderer {
  readonly renderer: WebGLRenderer
  readonly camera: PerspectiveCamera

  #tier: QualityTier
  #width = 1
  #height = 1
  #pixelRatio = 1

  #resizeObserver: ResizeObserver | null = null
  #disposed = false

  /** Fires after a resize, so scenes can re-lay-out anything screen-relative. */
  onResize: ((width: number, height: number) => void) | null = null

  constructor(options: RendererOptions) {
    this.#tier = options.tier ?? 'high'
    const profile = RENDER_PROFILES[this.#tier]

    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: profile.antialias,
      // We always draw an opaque sky, so the compositor can skip blending.
      alpha: false,
      powerPreference: 'high-performance',
      // Depth precision matters here: a big town with a near plane of 0.1
      // z-fights on road markings without it.
      logarithmicDepthBuffer: false,
      stencil: false,
    })

    this.renderer.outputColorSpace = SRGBColorSpace
    // ACES keeps bright saturated colours from clipping to white, which is
    // exactly the failure mode of a cheerful palette under a strong sun.
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = profile.shadowMapSize > 0
    this.renderer.shadowMap.type = PCFSoftShadowMap

    this.camera = new PerspectiveCamera(options.fov ?? 55, 1, 0.5, profile.drawDistance)

    this.#observe(options.canvas)
    this.resize()
  }

  get tier(): QualityTier {
    return this.#tier
  }

  get profile(): RenderQualityProfile {
    return RENDER_PROFILES[this.#tier]
  }

  get width(): number {
    return this.#width
  }

  get height(): number {
    return this.#height
  }

  get pixelRatio(): number {
    return this.#pixelRatio
  }

  get aspect(): number {
    return this.#height === 0 ? 1 : this.#width / this.#height
  }

  get isPortrait(): boolean {
    return this.#height > this.#width
  }

  /**
   * Switch quality tier. Shadows and pixel ratio change immediately; the
   * shadow map itself is owned by the light, so callers must re-apply it.
   */
  setTier(tier: QualityTier): void {
    if (tier === this.#tier) return
    this.#tier = tier
    const profile = RENDER_PROFILES[tier]

    this.renderer.shadowMap.enabled = profile.shadowMapSize > 0
    this.renderer.shadowMap.needsUpdate = true
    this.camera.far = profile.drawDistance
    this.camera.updateProjectionMatrix()
    this.resize()
  }

  /** Re-measure and resize. Cheap to call; early-outs when nothing changed. */
  resize(): boolean {
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()

    const cssWidth = Math.max(1, Math.round(rect.width || window.innerWidth))
    const cssHeight = Math.max(1, Math.round(rect.height || window.innerHeight))
    const ratio = Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio)

    if (cssWidth === this.#width && cssHeight === this.#height && ratio === this.#pixelRatio) {
      return false
    }

    this.#width = cssWidth
    this.#height = cssHeight
    this.#pixelRatio = ratio

    this.renderer.setPixelRatio(ratio)
    // `false` leaves the CSS size to the stylesheet, which owns layout.
    this.renderer.setSize(cssWidth, cssHeight, false)

    this.camera.aspect = cssWidth / cssHeight
    // On a narrow portrait screen a fixed vertical FOV shows far too little
    // horizontally. Widening it keeps roughly the same horizontal view.
    this.camera.fov = this.camera.aspect < 1 ? 68 : 55
    this.camera.updateProjectionMatrix()

    this.onResize?.(cssWidth, cssHeight)
    return true
  }

  render(scene: Scene): void {
    this.renderer.render(scene, this.camera)
  }

  /** Draw-call and triangle counts for the debug overlay. */
  get stats(): { calls: number; triangles: number; programs: number } {
    const info = this.renderer.info
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    window.removeEventListener('resize', this.#onWindowResize)
    window.removeEventListener('orientationchange', this.#onWindowResize)
    this.renderer.dispose()
  }

  #observe(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.resize())
      this.#resizeObserver.observe(canvas)
    }
    window.addEventListener('resize', this.#onWindowResize)
    window.addEventListener('orientationchange', this.#onWindowResize)
  }

  readonly #onWindowResize = (): void => {
    this.resize()
  }
}

/**
 * A guess at the starting tier from what the device reports. Unreliable by
 * nature, so the frame-rate watchdog corrects it within seconds either way —
 * this only avoids a terrible first impression.
 */
export function guessTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'medium'
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4
  if (cores <= 2 || memory <= 2) return 'low'
  if (cores <= 4 || memory <= 4) return 'medium'
  return 'high'
}
