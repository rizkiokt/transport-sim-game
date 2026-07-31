/**
 * Scalar math helpers shared across the engine.
 *
 * Everything here is pure, allocation-free, and safe to call thousands of
 * times per frame.
 */

export const TAU = Math.PI * 2
export const HALF_PI = Math.PI / 2
export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Clamp to the 0..1 range. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Inverse of {@link lerp}: where does `value` sit between `a` and `b`? */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a)
}

/** Map `value` from one range to another, without clamping. */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value))
}

/** {@link remap} with the output clamped to the destination range. */
export function remapClamped(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, clamp01(inverseLerp(inMin, inMax, value)))
}

/**
 * Framerate-independent exponential smoothing.
 *
 * A plain `lerp(current, target, 0.1)` per frame moves at a different speed at
 * 30fps than at 120fps. This variant converges at the same rate in wall-clock
 * time regardless of `dt`.
 *
 * @param smoothing fraction of the remaining distance left after one second
 *   (0.001 = very snappy, 0.5 = lazy). Must be in (0, 1).
 */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return lerp(current, target, 1 - Math.pow(smoothing, dt))
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const diff = target - current
  if (Math.abs(diff) <= maxDelta) return target
  return current + Math.sign(diff) * maxDelta
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, x))
  return t * t * (3 - 2 * t)
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Euclidean modulo — unlike `%`, the result always has the sign of `n`. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * Wrap an angle into [-PI, PI).
 *
 * Note the half-open end: exactly PI wraps to -PI. They are the same angle, so
 * this only matters when comparing a wrapped value against a literal bound.
 */
export function wrapAngle(radians: number): number {
  return mod(radians + Math.PI, TAU) - Math.PI
}

/**
 * Shortest signed angular distance from `from` to `to`, in [-PI, PI).
 * Use this instead of `to - from` so a car turning past due-north doesn't
 * spin the long way around.
 */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from)
}

/** Interpolate between two angles along the shortest arc. */
export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + angleDelta(from, to) * t)
}

/** {@link damp} for angles, taking the shortest arc. */
export function dampAngle(current: number, target: number, smoothing: number, dt: number): number {
  return lerpAngle(current, target, 1 - Math.pow(smoothing, dt))
}

/** {@link moveTowards} for angles, taking the shortest arc. */
export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const diff = angleDelta(current, target)
  if (Math.abs(diff) <= maxDelta) return wrapAngle(target)
  return wrapAngle(current + Math.sign(diff) * maxDelta)
}

/**
 * A critically-damped spring, the workhorse behind camera follow and UI
 * settle animations. Returns the new position and writes the new velocity
 * back through `velocity` (a one-element array used as an out-param to stay
 * allocation-free).
 *
 * @param smoothTime roughly the time in seconds to reach the target.
 */
export function springDamp(
  current: number,
  target: number,
  velocity: { value: number },
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity,
): number {
  // Standard Game Programming Gems 4 formulation.
  const omega = 2 / Math.max(0.0001, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)

  let change = current - target
  const maxChange = maxSpeed * smoothTime
  change = clamp(change, -maxChange, maxChange)

  const temp = (velocity.value + omega * change) * dt
  velocity.value = (velocity.value - omega * temp) * exp
  return target + (change + temp) * exp
}

/** Snap tiny values to zero so idle objects stop jittering. */
export function deadzone(value: number, threshold: number): number {
  return Math.abs(value) < threshold ? 0 : value
}

/**
 * Radial deadzone with rescaling: below `threshold` returns 0, above it the
 * output ramps from 0 to 1 so there is no jump at the boundary. Used for
 * thumbsticks and drag-steering.
 */
export function deadzoneScaled(magnitude: number, threshold: number): number {
  if (magnitude <= threshold) return 0
  return clamp01((magnitude - threshold) / (1 - threshold))
}

/** Round to a fixed number of decimals — mainly for debug readouts. */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/** Format an integer with thousands separators, for coin counters. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}
