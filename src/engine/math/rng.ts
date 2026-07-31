/**
 * Seeded pseudo-random number generation.
 *
 * The whole city is generated procedurally, so the same seed must always
 * produce the same town — otherwise a child's saved game would rearrange
 * itself between sessions. `Math.random()` is therefore banned in world
 * generation; use an {@link Rng} instance instead.
 *
 * Cosmetic, non-persistent effects (particle jitter, sound detune) may use a
 * shared throwaway generator — see {@link cosmeticRng}.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [min, max). */
  range(min: number, max: number): number
  /** Uniform integer in [min, max] — both ends inclusive. */
  int(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T
  /** A weighted choice; `weights` must be the same length as `items`. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T
  /** Fisher-Yates shuffle, in place; returns the same array. */
  shuffle<T>(items: T[]): T[]
  /** Normally-distributed value with the given mean and standard deviation. */
  gaussian(mean?: number, stdDev?: number): number
  /** A value in [-1, 1). */
  signed(): number
  /** A point uniformly distributed inside the unit circle. */
  insideCircle(): { x: number; y: number }
  /** A fresh generator deterministically derived from this one. */
  fork(label?: string): Rng
  /** The seed this generator was created with. */
  readonly seed: number
}

/**
 * Hash a string to a 32-bit seed. Lets us name seeds
 * (`createRng(hashString('district:harbour'))`) instead of juggling magic
 * numbers, and keeps derived streams stable across releases.
 */
export function hashString(str: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * mulberry32 — small, fast, and statistically good enough for level
 * generation and visual variety. Not cryptographic; never use it for anything
 * that needs to be unguessable.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: number | string = 1): Rng {
  const numericSeed = typeof seed === 'string' ? hashString(seed) : seed >>> 0
  const next = mulberry32(numericSeed)

  // Cached second value from the Box-Muller pair, so gaussian() only pays for
  // the trig on every other call.
  let spareGaussian: number | null = null
  let forkCounter = 0

  const rng: Rng = {
    seed: numericSeed,

    next,

    range(min, max) {
      return min + next() * (max - min)
    },

    int(min, max) {
      return Math.floor(min + next() * (max - min + 1))
    },

    chance(p) {
      return next() < p
    },

    pick(items) {
      if (items.length === 0) {
        throw new Error('Rng.pick: cannot pick from an empty array')
      }
      return items[Math.floor(next() * items.length)]!
    },

    pickWeighted(items, weights) {
      if (items.length === 0) {
        throw new Error('Rng.pickWeighted: cannot pick from an empty array')
      }
      if (items.length !== weights.length) {
        throw new Error('Rng.pickWeighted: items and weights must be the same length')
      }

      let total = 0
      for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]!)
      if (total <= 0) return items[Math.floor(next() * items.length)]!

      let roll = next() * total
      for (let i = 0; i < items.length; i++) {
        roll -= Math.max(0, weights[i]!)
        if (roll < 0) return items[i]!
      }
      return items[items.length - 1]!
    },

    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = items[i]!
        items[i] = items[j]!
        items[j] = tmp
      }
      return items
    },

    gaussian(mean = 0, stdDev = 1) {
      if (spareGaussian !== null) {
        const value = spareGaussian
        spareGaussian = null
        return mean + value * stdDev
      }
      // Box-Muller. Guard against log(0).
      let u = 0
      let v = 0
      while (u === 0) u = next()
      while (v === 0) v = next()
      const mag = Math.sqrt(-2 * Math.log(u))
      spareGaussian = mag * Math.sin(2 * Math.PI * v)
      return mean + mag * Math.cos(2 * Math.PI * v) * stdDev
    },

    signed() {
      return next() * 2 - 1
    },

    insideCircle() {
      // Rejection sampling: simpler and faster on average than sqrt-based
      // polar sampling, and avoids the clustering bug of naive polar.
      for (;;) {
        const x = next() * 2 - 1
        const y = next() * 2 - 1
        if (x * x + y * y <= 1) return { x, y }
      }
    },

    fork(label) {
      // Derive a fresh, well-separated stream. Mixing in a counter means
      // repeated forks without a label still diverge.
      const mixed = hashString(`${numericSeed}:${label ?? ''}:${forkCounter++}`)
      return createRng(mixed)
    },
  }

  return rng
}

/**
 * Shared generator for effects that are purely cosmetic and never persisted:
 * particle jitter, sound detune, idle wobble phase. Seeded with a constant so
 * even these stay reproducible in tests and headless balance runs.
 */
export const cosmeticRng: Rng = createRng('cosmetic')

/**
 * Deterministic value noise in 1D — smooth, repeatable wiggle for things like
 * road-side decoration density or a swaying tree's phase.
 */
export function valueNoise1D(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const a = hashedUnit(i, seed)
  const b = hashedUnit(i + 1, seed)
  const t = f * f * (3 - 2 * f)
  return a + (b - a) * t
}

/** Deterministic value noise in 2D — building height/colour variation. */
export function valueNoise2D(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  const tl = hashedUnit2(xi, yi, seed)
  const tr = hashedUnit2(xi + 1, yi, seed)
  const bl = hashedUnit2(xi, yi + 1, seed)
  const br = hashedUnit2(xi + 1, yi + 1, seed)

  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)

  const top = tl + (tr - tl) * u
  const bottom = bl + (br - bl) * u
  return top + (bottom - top) * v
}

/** Hash an integer to [0, 1). */
export function hashedUnit(n: number, seed = 0): number {
  let h = Math.imul(n ^ seed, 0x27d4eb2d)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** Hash a 2D integer coordinate to [0, 1). */
export function hashedUnit2(x: number, y: number, seed = 0): number {
  return hashedUnit(Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x8da6b343), seed)
}
