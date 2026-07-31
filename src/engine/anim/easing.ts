/**
 * Easing curves.
 *
 * Every function maps 0..1 to (roughly) 0..1. The `back` and `elastic`
 * families deliberately overshoot outside that range — that overshoot is what
 * makes UI feel bouncy and alive to a young player, so it is a feature, not a
 * bug. Anything drawn with them needs a little headroom in its layout.
 */

export type EasingFn = (t: number) => number

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5
const n1 = 7.5625
const d1 = 2.75

export const linear: EasingFn = (t) => t

export const inQuad: EasingFn = (t) => t * t
export const outQuad: EasingFn = (t) => 1 - (1 - t) * (1 - t)
export const inOutQuad: EasingFn = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

export const inCubic: EasingFn = (t) => t * t * t
export const outCubic: EasingFn = (t) => 1 - Math.pow(1 - t, 3)
export const inOutCubic: EasingFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export const inQuart: EasingFn = (t) => t * t * t * t
export const outQuart: EasingFn = (t) => 1 - Math.pow(1 - t, 4)
export const inOutQuart: EasingFn = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2

export const inQuint: EasingFn = (t) => t * t * t * t * t
export const outQuint: EasingFn = (t) => 1 - Math.pow(1 - t, 5)
export const inOutQuint: EasingFn = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2

export const inSine: EasingFn = (t) => 1 - Math.cos((t * Math.PI) / 2)
export const outSine: EasingFn = (t) => Math.sin((t * Math.PI) / 2)
export const inOutSine: EasingFn = (t) => -(Math.cos(Math.PI * t) - 1) / 2

export const inExpo: EasingFn = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10))
export const outExpo: EasingFn = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const inOutExpo: EasingFn = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2

export const inCirc: EasingFn = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2))
export const outCirc: EasingFn = (t) => Math.sqrt(1 - Math.pow(t - 1, 2))
export const inOutCirc: EasingFn = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2

/** Anticipation: pulls back before moving forward. */
export const inBack: EasingFn = (t) => c3 * t * t * t - c1 * t * t
/** Overshoot: sails past the target then settles. The default "pop" curve. */
export const outBack: EasingFn = (t) =>
  1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
export const inOutBack: EasingFn = (t) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2

export const inElastic: EasingFn = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
/** Springy wobble. Reserve for celebrations — it is loud. */
export const outElastic: EasingFn = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
export const inOutElastic: EasingFn = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1

/** Bouncing ball settle. Great for coins and dropped objects. */
export const outBounce: EasingFn = (t) => {
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
export const inBounce: EasingFn = (t) => 1 - outBounce(1 - t)
export const inOutBounce: EasingFn = (t) =>
  t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2

/**
 * A 0 -> 1 -> 0 pulse. Handy for one-shot effects such as a squash on impact
 * or an icon flash, where the value must return to rest on its own.
 */
export const pulse: EasingFn = (t) => Math.sin(t * Math.PI)

/** A sharper pulse that peaks early and decays — impact flashes. */
export const spike: EasingFn = (t) => (t < 0.5 ? outCubic(t * 2) : outCubic((1 - t) * 2))

/**
 * Build a decaying oscillation, e.g. a car body still wobbling after a bump.
 *
 * @param frequency oscillations across the full duration
 * @param decay higher values settle faster
 */
export function makeWobble(frequency = 3, decay = 6): EasingFn {
  return (t) => Math.sin(t * Math.PI * 2 * frequency) * Math.exp(-t * decay)
}

/**
 * Build a custom overshoot curve.
 *
 * @param amount 0 = no overshoot (equivalent to outCubic-ish), 1.7 = the
 *   standard `outBack`, 3+ = cartoonishly springy.
 */
export function makeOutBack(amount = c1): EasingFn {
  const k = amount + 1
  return (t) => 1 + k * Math.pow(t - 1, 3) + amount * Math.pow(t - 1, 2)
}

/** Play any easing in reverse. */
export function reverse(fn: EasingFn): EasingFn {
  return (t) => 1 - fn(1 - t)
}

/** Mirror an easing around its midpoint, producing an in-out variant. */
export function mirror(fn: EasingFn): EasingFn {
  return (t) => (t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2)
}

/** Run `fn` forward then backward within a single 0..1 pass. */
export function yoyo(fn: EasingFn): EasingFn {
  return (t) => (t < 0.5 ? fn(t * 2) : fn((1 - t) * 2))
}

/**
 * Named registry so easings can be referenced from content data files
 * (`{ ease: 'outBack' }`) without importing functions into JSON-ish content.
 */
export const EASINGS = {
  linear,
  inQuad,
  outQuad,
  inOutQuad,
  inCubic,
  outCubic,
  inOutCubic,
  inQuart,
  outQuart,
  inOutQuart,
  inQuint,
  outQuint,
  inOutQuint,
  inSine,
  outSine,
  inOutSine,
  inExpo,
  outExpo,
  inOutExpo,
  inCirc,
  outCirc,
  inOutCirc,
  inBack,
  outBack,
  inOutBack,
  inElastic,
  outElastic,
  inOutElastic,
  inBounce,
  outBounce,
  inOutBounce,
  pulse,
  spike,
} as const satisfies Record<string, EasingFn>

export type EasingName = keyof typeof EASINGS

export function getEasing(name: EasingName): EasingFn {
  return EASINGS[name]
}
