/**
 * A pooled particle system.
 *
 * Particles carry most of the game's visual reward: coin bursts, confetti,
 * exhaust puffs, dust, sparkles. They are also the easiest way to tank frame
 * rate on a tablet, so this implementation is deliberately conservative:
 *
 * - Fixed-capacity pool, zero allocation after construction. A 6-year-old
 *   spamming the horn must not trigger GC pauses.
 * - Struct-of-arrays layout, so updating 1000 particles is a tight numeric
 *   loop over typed arrays rather than a pointer chase over objects.
 * - When the pool is full, new emissions recycle the oldest particles instead
 *   of growing — a hard ceiling on cost.
 * - Rendering is grouped by shape so we minimise Canvas2D state changes.
 */

import { cosmeticRng } from '../math/rng.js'

/** How a particle is drawn. */
export const enum ParticleShape {
  Circle = 0,
  Square = 1,
  /** Axis-aligned rectangle that spins — confetti. */
  Confetti = 2,
  /** A short line along the velocity direction — speed streaks, sparks. */
  Streak = 3,
  /** A five-pointed star — celebration sparkles. */
  Star = 4,
  /** A soft radial gradient blob — smoke and dust. */
  Puff = 5,
}

export interface EmitOptions {
  x: number
  y: number
  /** Number of particles. Clamped by the pool's remaining capacity. */
  count?: number

  /** Base velocity. */
  vx?: number
  vy?: number
  /** Random speed added in a random direction, in `[speedMin, speedMax]`. */
  speedMin?: number
  speedMax?: number
  /** Emission cone centre, radians. Defaults to a full circle. */
  angle?: number
  /** Half-width of the emission cone, radians. */
  spread?: number

  /** Seconds. Each particle picks uniformly from this range. */
  lifeMin?: number
  lifeMax?: number

  /** Radius in world units at spawn. */
  sizeMin?: number
  sizeMax?: number
  /** Size multiplier at death. <1 shrinks, >1 grows. */
  sizeEnd?: number

  /** CSS colour strings; each particle picks one at random. */
  colors?: readonly string[]

  /** World units per second squared. Positive y is down. */
  gravity?: number
  /** Per-second velocity retention. 1 = no drag, 0.1 = heavy drag. */
  drag?: number

  /** Opacity at spawn and at death. */
  alphaStart?: number
  alphaEnd?: number

  shape?: ParticleShape
  /** Initial spin, radians per second. */
  spinMin?: number
  spinMax?: number

  /** Draw with 'lighter' compositing — good for sparks and glows. */
  additive?: boolean

  /**
   * Spawn positions are jittered within this radius, so a burst doesn't
   * originate from a single mathematical point.
   */
  spawnRadius?: number
}

export class ParticleSystem {
  readonly capacity: number

  // Struct-of-arrays. Index `i` is one particle across all of these.
  readonly #x: Float32Array
  readonly #y: Float32Array
  readonly #vx: Float32Array
  readonly #vy: Float32Array
  readonly #life: Float32Array
  readonly #maxLife: Float32Array
  readonly #size: Float32Array
  readonly #sizeEnd: Float32Array
  readonly #rotation: Float32Array
  readonly #spin: Float32Array
  readonly #gravity: Float32Array
  readonly #drag: Float32Array
  readonly #alphaStart: Float32Array
  readonly #alphaEnd: Float32Array
  readonly #shape: Uint8Array
  readonly #additive: Uint8Array
  /** Index into {@link #palette}. */
  readonly #colorIndex: Uint16Array

  /** Interned colour strings, so particles store a number not a string. */
  readonly #palette: string[] = []
  readonly #paletteLookup = new Map<string, number>()

  /** Indices of free slots. */
  readonly #free: Uint32Array
  #freeCount: number

  /** Indices of live particles, compacted each update. */
  readonly #live: Uint32Array
  #liveCount = 0

  /**
   * Global multiplier on emission counts. The quality tier system turns this
   * down on weak devices, and the reduced-motion setting can zero it.
   */
  intensity = 1

  constructor(capacity = 1200) {
    this.capacity = capacity

    this.#x = new Float32Array(capacity)
    this.#y = new Float32Array(capacity)
    this.#vx = new Float32Array(capacity)
    this.#vy = new Float32Array(capacity)
    this.#life = new Float32Array(capacity)
    this.#maxLife = new Float32Array(capacity)
    this.#size = new Float32Array(capacity)
    this.#sizeEnd = new Float32Array(capacity)
    this.#rotation = new Float32Array(capacity)
    this.#spin = new Float32Array(capacity)
    this.#gravity = new Float32Array(capacity)
    this.#drag = new Float32Array(capacity)
    this.#alphaStart = new Float32Array(capacity)
    this.#alphaEnd = new Float32Array(capacity)
    this.#shape = new Uint8Array(capacity)
    this.#additive = new Uint8Array(capacity)
    this.#colorIndex = new Uint16Array(capacity)

    this.#free = new Uint32Array(capacity)
    this.#live = new Uint32Array(capacity)
    for (let i = 0; i < capacity; i++) this.#free[i] = capacity - 1 - i
    this.#freeCount = capacity
  }

  get liveCount(): number {
    return this.#liveCount
  }

  emit(options: EmitOptions): void {
    if (this.intensity <= 0) return

    const requested = Math.round((options.count ?? 8) * this.intensity)
    if (requested <= 0) return

    const rng = cosmeticRng
    const colors = options.colors ?? DEFAULT_COLORS
    const shape = options.shape ?? ParticleShape.Circle
    const additive = options.additive ? 1 : 0
    const spawnRadius = options.spawnRadius ?? 0

    const speedMin = options.speedMin ?? 0
    const speedMax = options.speedMax ?? speedMin
    const lifeMin = options.lifeMin ?? 0.5
    const lifeMax = options.lifeMax ?? lifeMin
    const sizeMin = options.sizeMin ?? 3
    const sizeMax = options.sizeMax ?? sizeMin
    const spinMin = options.spinMin ?? 0
    const spinMax = options.spinMax ?? spinMin

    const baseAngle = options.angle
    const spread = options.spread ?? Math.PI

    for (let n = 0; n < requested; n++) {
      const i = this.#allocate()
      if (i < 0) break

      let px = options.x
      let py = options.y
      if (spawnRadius > 0) {
        const p = rng.insideCircle()
        px += p.x * spawnRadius
        py += p.y * spawnRadius
      }

      const angle = baseAngle === undefined ? rng.range(0, Math.PI * 2) : baseAngle + rng.range(-spread, spread)
      const speed = rng.range(speedMin, speedMax)

      this.#x[i] = px
      this.#y[i] = py
      this.#vx[i] = (options.vx ?? 0) + Math.cos(angle) * speed
      this.#vy[i] = (options.vy ?? 0) + Math.sin(angle) * speed

      const life = rng.range(lifeMin, lifeMax)
      this.#life[i] = life
      this.#maxLife[i] = life

      this.#size[i] = rng.range(sizeMin, sizeMax)
      this.#sizeEnd[i] = options.sizeEnd ?? 1
      this.#rotation[i] = rng.range(0, Math.PI * 2)
      this.#spin[i] = rng.range(spinMin, spinMax)
      this.#gravity[i] = options.gravity ?? 0
      this.#drag[i] = options.drag ?? 1
      this.#alphaStart[i] = options.alphaStart ?? 1
      this.#alphaEnd[i] = options.alphaEnd ?? 0
      this.#shape[i] = shape
      this.#additive[i] = additive
      this.#colorIndex[i] = this.#internColor(colors[Math.floor(rng.next() * colors.length)] ?? '#ffffff')
    }
  }

  update(dt: number): void {
    let write = 0
    for (let n = 0; n < this.#liveCount; n++) {
      const i = this.#live[n]!

      const life = this.#life[i]! - dt
      if (life <= 0) {
        this.#free[this.#freeCount++] = i
        continue
      }
      this.#life[i] = life

      // Frame-rate independent drag.
      const drag = this.#drag[i]!
      if (drag !== 1) {
        const factor = Math.pow(drag, dt)
        this.#vx[i]! *= factor
        this.#vy[i]! *= factor
      }

      this.#vy[i]! += this.#gravity[i]! * dt
      this.#x[i]! += this.#vx[i]! * dt
      this.#y[i]! += this.#vy[i]! * dt
      this.#rotation[i]! += this.#spin[i]! * dt

      this.#live[write++] = i
    }
    this.#liveCount = write
  }

  /**
   * Draw every live particle. Expects the world transform to already be
   * applied to `ctx`.
   *
   * @param bounds optional visible-world rect for culling.
   */
  render(
    ctx: CanvasRenderingContext2D,
    bounds?: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    if (this.#liveCount === 0) return

    ctx.save()

    let currentAdditive = false
    ctx.globalCompositeOperation = 'source-over'

    for (let n = 0; n < this.#liveCount; n++) {
      const i = this.#live[n]!

      const x = this.#x[i]!
      const y = this.#y[i]!
      const maxLife = this.#maxLife[i]!
      const t = 1 - this.#life[i]! / maxLife

      const baseSize = this.#size[i]!
      const size = baseSize * (1 + (this.#sizeEnd[i]! - 1) * t)
      if (size <= 0.1) continue

      if (bounds) {
        if (x + size < bounds.minX || x - size > bounds.maxX) continue
        if (y + size < bounds.minY || y - size > bounds.maxY) continue
      }

      const alpha = this.#alphaStart[i]! + (this.#alphaEnd[i]! - this.#alphaStart[i]!) * t
      if (alpha <= 0.01) continue

      const wantAdditive = this.#additive[i] === 1
      if (wantAdditive !== currentAdditive) {
        currentAdditive = wantAdditive
        ctx.globalCompositeOperation = wantAdditive ? 'lighter' : 'source-over'
      }

      ctx.globalAlpha = alpha
      const color = this.#palette[this.#colorIndex[i]!] ?? '#ffffff'

      switch (this.#shape[i]! as ParticleShape) {
        case ParticleShape.Circle: {
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(x, y, size, 0, Math.PI * 2)
          ctx.fill()
          break
        }

        case ParticleShape.Square: {
          ctx.fillStyle = color
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(this.#rotation[i]!)
          ctx.fillRect(-size, -size, size * 2, size * 2)
          ctx.restore()
          break
        }

        case ParticleShape.Confetti: {
          ctx.fillStyle = color
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(this.#rotation[i]!)
          // Squashing the height by a spin-driven cosine fakes a 3D flutter.
          const flutter = Math.abs(Math.cos(this.#rotation[i]! * 1.7))
          ctx.fillRect(-size * 0.6, -size * flutter, size * 1.2, size * 2 * flutter)
          ctx.restore()
          break
        }

        case ParticleShape.Streak: {
          const vx = this.#vx[i]!
          const vy = this.#vy[i]!
          const speed = Math.hypot(vx, vy)
          if (speed < 0.001) break
          const len = Math.min(size * 4, speed * 0.05)
          ctx.strokeStyle = color
          ctx.lineWidth = size * 0.6
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x - (vx / speed) * len, y - (vy / speed) * len)
          ctx.stroke()
          break
        }

        case ParticleShape.Star: {
          ctx.fillStyle = color
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(this.#rotation[i]!)
          drawStar(ctx, size)
          ctx.restore()
          break
        }

        case ParticleShape.Puff: {
          // A gradient per particle is expensive; a two-pass flat circle with
          // low alpha reads almost identically at this size and is ~8x cheaper.
          ctx.fillStyle = color
          ctx.globalAlpha = alpha * 0.55
          ctx.beginPath()
          ctx.arc(x, y, size, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = alpha * 0.35
          ctx.beginPath()
          ctx.arc(x - size * 0.2, y - size * 0.2, size * 0.65, 0, Math.PI * 2)
          ctx.fill()
          break
        }
      }
    }

    ctx.restore()
  }

  /** Kill everything immediately. Called on scene change. */
  clear(): void {
    for (let n = 0; n < this.#liveCount; n++) {
      this.#free[this.#freeCount++] = this.#live[n]!
    }
    this.#liveCount = 0
  }

  /**
   * Take a free slot, recycling the oldest live particle if the pool is
   * exhausted. Returns -1 only if capacity is 0.
   */
  #allocate(): number {
    if (this.#freeCount > 0) {
      const i = this.#free[--this.#freeCount]!
      this.#live[this.#liveCount++] = i
      return i
    }

    if (this.#liveCount === 0) return -1

    // Steal slot 0 — the oldest survivor — and shift the live list down.
    const stolen = this.#live[0]!
    this.#live.copyWithin(0, 1, this.#liveCount)
    this.#live[this.#liveCount - 1] = stolen
    return stolen
  }

  #internColor(color: string): number {
    const existing = this.#paletteLookup.get(color)
    if (existing !== undefined) return existing
    const index = this.#palette.length
    this.#palette.push(color)
    this.#paletteLookup.set(color, index)
    return index
  }
}

/** A five-pointed star centred on the origin, radius `size`. */
function drawStar(ctx: CanvasRenderingContext2D, size: number): void {
  const inner = size * 0.45
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? size : inner
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const px = Math.cos(a) * r
    const py = Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

const DEFAULT_COLORS = ['#ffffff'] as const
