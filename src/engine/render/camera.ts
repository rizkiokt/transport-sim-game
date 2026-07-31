/**
 * The world camera: follow, lookahead, zoom, shake, and world<->screen
 * transforms.
 *
 * Camera behaviour is a huge part of how a driving game *feels*. The rules
 * here are tuned for a young player:
 *
 * - The camera lags slightly behind the car (spring damping) so motion reads
 *   as weighty rather than rigid.
 * - It leads in the direction of travel, so the child can see where they are
 *   going instead of where they have been.
 * - It zooms out as speed rises, which subconsciously communicates "you are
 *   fast now" and gives more reaction time.
 * - Shake is always brief and gentle; a 6-year-old finds a violent camera
 *   genuinely unpleasant, and it can trigger motion sickness.
 */

import { clamp, damp, lerp, springDamp } from '../math/scalar.js'
import { cosmeticRng } from '../math/rng.js'
import { type ReadonlyVec2, type Vec2, vec2 } from '../math/vec2.js'

export interface CameraOptions {
  /** Seconds for the position spring to converge. Higher = laggier. */
  followSmoothTime?: number
  /** Seconds for the zoom to converge. */
  zoomSmoothTime?: number
  /** How far ahead of the target to look, per unit of target speed. */
  lookaheadPerSpeed?: number
  /** Hard cap on lookahead distance, in world units. */
  maxLookahead?: number
  /** Zoom at rest. >1 magnifies. */
  baseZoom?: number
  /** Zoom multiplier applied at `speedForMinZoom`. <1 pulls the view back. */
  speedZoomOut?: number
  /** Target speed at which `speedZoomOut` is fully applied. */
  speedForMinZoom?: number
}

interface ShakeState {
  /** Remaining time, seconds. */
  time: number
  /** Total duration, for computing decay. */
  duration: number
  /** Peak offset in world units. */
  magnitude: number
  /** Oscillations per second. */
  frequency: number
  /** Random phase offsets so repeated shakes don't look identical. */
  phaseX: number
  phaseY: number
}

export class Camera {
  /** Camera centre in world space. */
  readonly position: Vec2 = vec2()

  /** Current zoom. Larger = more magnified. */
  zoom = 1

  /** Rotation in radians. Kept at 0 for this game but supported by the transform. */
  rotation = 0

  /** Viewport size in CSS pixels. Updated by {@link setViewportSize}. */
  #viewWidth = 1
  #viewHeight = 1

  readonly #opts: Required<CameraOptions>

  /** Where the camera is trying to be, before smoothing. */
  readonly #desired: Vec2 = vec2()
  readonly #lookahead: Vec2 = vec2()
  readonly #velocity = { x: { value: 0 }, y: { value: 0 } }

  #desiredZoom = 1
  #zoomVelocity = { value: 0 }

  /** Additional zoom multiplier from punch-in effects. */
  #zoomPunch = 1
  #zoomPunchVelocity = { value: 0 }

  readonly #shakes: ShakeState[] = []
  readonly #shakeOffset: Vec2 = vec2()

  /** Optional world-space bounds the camera centre is clamped inside. */
  #bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null

  /** Global multiplier for shake, so "reduced motion" can disable it. */
  shakeScale = 1

  constructor(options: CameraOptions = {}) {
    this.#opts = {
      followSmoothTime: options.followSmoothTime ?? 0.22,
      zoomSmoothTime: options.zoomSmoothTime ?? 0.5,
      lookaheadPerSpeed: options.lookaheadPerSpeed ?? 0.35,
      maxLookahead: options.maxLookahead ?? 140,
      baseZoom: options.baseZoom ?? 1,
      speedZoomOut: options.speedZoomOut ?? 0.82,
      speedForMinZoom: options.speedForMinZoom ?? 260,
    }
    this.zoom = this.#opts.baseZoom
    this.#desiredZoom = this.#opts.baseZoom
  }

  setViewportSize(width: number, height: number): void {
    this.#viewWidth = Math.max(1, width)
    this.#viewHeight = Math.max(1, height)
  }

  get viewWidth(): number {
    return this.#viewWidth
  }

  get viewHeight(): number {
    return this.#viewHeight
  }

  /** The effective zoom actually used for rendering, including punch. */
  get effectiveZoom(): number {
    return this.zoom * this.#zoomPunch
  }

  /** Constrain the camera centre so the view never leaves the world. */
  setBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    this.#bounds = { minX, minY, maxX, maxY }
  }

  clearBounds(): void {
    this.#bounds = null
  }

  /** Jump instantly to a position, cancelling smoothing. Use on scene entry. */
  snapTo(x: number, y: number): void {
    this.position.x = x
    this.position.y = y
    this.#desired.x = x
    this.#desired.y = y
    this.#velocity.x.value = 0
    this.#velocity.y.value = 0
    this.#lookahead.x = 0
    this.#lookahead.y = 0
    this.#clampToBounds()
  }

  /**
   * Follow a target, leading in its direction of travel.
   *
   * @param target world position to centre on
   * @param velocity target velocity, used for lookahead and speed zoom
   * @param dt seconds
   */
  follow(target: ReadonlyVec2, velocity: ReadonlyVec2, dt: number): void {
    const speed = Math.hypot(velocity.x, velocity.y)

    // Lookahead is itself smoothed, otherwise the view snaps around every time
    // the car changes direction, which is nauseating.
    const leadX = clamp(
      velocity.x * this.#opts.lookaheadPerSpeed,
      -this.#opts.maxLookahead,
      this.#opts.maxLookahead,
    )
    const leadY = clamp(
      velocity.y * this.#opts.lookaheadPerSpeed,
      -this.#opts.maxLookahead,
      this.#opts.maxLookahead,
    )
    this.#lookahead.x = damp(this.#lookahead.x, leadX, 0.02, dt)
    this.#lookahead.y = damp(this.#lookahead.y, leadY, 0.02, dt)

    this.#desired.x = target.x + this.#lookahead.x
    this.#desired.y = target.y + this.#lookahead.y

    this.position.x = springDamp(
      this.position.x,
      this.#desired.x,
      this.#velocity.x,
      this.#opts.followSmoothTime,
      dt,
    )
    this.position.y = springDamp(
      this.position.y,
      this.#desired.y,
      this.#velocity.y,
      this.#opts.followSmoothTime,
      dt,
    )

    // Faster driving pulls the camera back so more road is visible.
    const speedT = clamp(speed / this.#opts.speedForMinZoom, 0, 1)
    this.#desiredZoom = this.#opts.baseZoom * lerp(1, this.#opts.speedZoomOut, speedT)

    this.#clampToBounds()
  }

  /** Advance shake, zoom smoothing, and punch decay. Call once per fixed step. */
  update(dt: number): void {
    this.zoom = springDamp(
      this.zoom,
      this.#desiredZoom,
      this.#zoomVelocity,
      this.#opts.zoomSmoothTime,
      dt,
    )

    this.#zoomPunch = springDamp(this.#zoomPunch, 1, this.#zoomPunchVelocity, 0.28, dt)

    this.#updateShake(dt)
  }

  /** Override the target zoom directly, e.g. for a cutscene or the garage view. */
  setZoom(zoom: number, immediate = false): void {
    this.#desiredZoom = zoom
    if (immediate) {
      this.zoom = zoom
      this.#zoomVelocity.value = 0
    }
  }

  /**
   * A quick magnify-and-settle, for celebration beats.
   *
   * @param amount 0.08 is a subtle pop; 0.2 is a big one.
   */
  punchZoom(amount = 0.08): void {
    this.#zoomPunch = 1 + amount
    this.#zoomPunchVelocity.value = 0
  }

  /**
   * Shake the camera. Multiple shakes stack, and each decays independently.
   *
   * @param magnitude peak offset in world units. Keep at or below ~8 for this
   *   audience — anything stronger reads as "something bad happened".
   * @param duration seconds
   * @param frequency oscillations per second
   */
  shake(magnitude: number, duration = 0.3, frequency = 22): void {
    if (this.shakeScale <= 0 || magnitude <= 0 || duration <= 0) return
    this.#shakes.push({
      time: duration,
      duration,
      magnitude,
      frequency,
      phaseX: cosmeticRng.range(0, Math.PI * 2),
      phaseY: cosmeticRng.range(0, Math.PI * 2),
    })
  }

  #updateShake(dt: number): void {
    this.#shakeOffset.x = 0
    this.#shakeOffset.y = 0

    for (let i = this.#shakes.length - 1; i >= 0; i--) {
      const s = this.#shakes[i]!
      s.time -= dt
      if (s.time <= 0) {
        this.#shakes.splice(i, 1)
        continue
      }

      // Decay quadratically so the tail is gentle rather than a hard stop.
      const t = s.time / s.duration
      const decay = t * t
      const elapsed = s.duration - s.time
      const angle = elapsed * s.frequency * Math.PI * 2

      this.#shakeOffset.x += Math.sin(angle + s.phaseX) * s.magnitude * decay * this.shakeScale
      this.#shakeOffset.y += Math.cos(angle * 0.9 + s.phaseY) * s.magnitude * decay * this.shakeScale
    }
  }

  #clampToBounds(): void {
    const b = this.#bounds
    if (!b) return

    // Half the visible world extent at the current zoom.
    const halfW = this.#viewWidth / (2 * this.effectiveZoom)
    const halfH = this.#viewHeight / (2 * this.effectiveZoom)

    // When the world is narrower than the view, centre it instead of clamping
    // to an inverted range (which would jitter between the two limits).
    if (b.maxX - b.minX <= halfW * 2) {
      this.position.x = (b.minX + b.maxX) / 2
    } else {
      this.position.x = clamp(this.position.x, b.minX + halfW, b.maxX - halfW)
    }

    if (b.maxY - b.minY <= halfH * 2) {
      this.position.y = (b.minY + b.maxY) / 2
    } else {
      this.position.y = clamp(this.position.y, b.minY + halfH, b.maxY - halfH)
    }
  }

  /**
   * Apply the camera transform to a context. The caller is responsible for
   * `save()`/`restore()` around it.
   *
   * @param alpha render interpolation factor, unused here because the camera
   *   is already smoothed, but accepted for symmetry with other renderers.
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    const zoom = this.effectiveZoom
    ctx.translate(this.#viewWidth / 2, this.#viewHeight / 2)
    ctx.scale(zoom, zoom)
    if (this.rotation !== 0) ctx.rotate(-this.rotation)
    ctx.translate(
      -(this.position.x + this.#shakeOffset.x),
      -(this.position.y + this.#shakeOffset.y),
    )
  }

  worldToScreen(world: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
    const zoom = this.effectiveZoom
    let dx = world.x - (this.position.x + this.#shakeOffset.x)
    let dy = world.y - (this.position.y + this.#shakeOffset.y)

    if (this.rotation !== 0) {
      const c = Math.cos(-this.rotation)
      const s = Math.sin(-this.rotation)
      const rx = dx * c - dy * s
      dy = dx * s + dy * c
      dx = rx
    }

    out.x = dx * zoom + this.#viewWidth / 2
    out.y = dy * zoom + this.#viewHeight / 2
    return out
  }

  screenToWorld(screen: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
    const zoom = this.effectiveZoom
    let dx = (screen.x - this.#viewWidth / 2) / zoom
    let dy = (screen.y - this.#viewHeight / 2) / zoom

    if (this.rotation !== 0) {
      const c = Math.cos(this.rotation)
      const s = Math.sin(this.rotation)
      const rx = dx * c - dy * s
      dy = dx * s + dy * c
      dx = rx
    }

    out.x = dx + this.position.x + this.#shakeOffset.x
    out.y = dy + this.position.y + this.#shakeOffset.y
    return out
  }

  /**
   * The world-space rectangle currently visible, expanded by `padding`.
   * Everything that draws should cull against this — it is the single
   * biggest performance lever in a scrolling Canvas2D game.
   */
  getVisibleBounds(
    padding = 0,
    out = { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    const zoom = this.effectiveZoom
    let halfW = this.#viewWidth / (2 * zoom) + padding
    let halfH = this.#viewHeight / (2 * zoom) + padding

    if (this.rotation !== 0) {
      // A rotated view's axis-aligned bound is the rotated rect's extent.
      const c = Math.abs(Math.cos(this.rotation))
      const s = Math.abs(Math.sin(this.rotation))
      const w = halfW * c + halfH * s
      const h = halfW * s + halfH * c
      halfW = w
      halfH = h
    }

    const cx = this.position.x + this.#shakeOffset.x
    const cy = this.position.y + this.#shakeOffset.y
    out.minX = cx - halfW
    out.minY = cy - halfH
    out.maxX = cx + halfW
    out.maxY = cy + halfH
    return out
  }

  /** Fast circle-vs-view test for culling. */
  isVisible(x: number, y: number, radius: number): boolean {
    const zoom = this.effectiveZoom
    const halfW = this.#viewWidth / (2 * zoom) + radius
    const halfH = this.#viewHeight / (2 * zoom) + radius
    const cx = this.position.x + this.#shakeOffset.x
    const cy = this.position.y + this.#shakeOffset.y
    return Math.abs(x - cx) <= halfW && Math.abs(y - cy) <= halfH
  }
}
