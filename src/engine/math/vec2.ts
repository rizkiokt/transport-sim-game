/**
 * 2D vector helpers.
 *
 * Vectors are plain `{ x, y }` objects rather than class instances so they
 * stay cheap to allocate, easy to serialise, and friendly to the JIT. Every
 * operation that produces a vector accepts an optional `out` parameter so hot
 * paths can run without allocating.
 */

import { clamp, lerp, TAU, wrapAngle } from './scalar.js'

export interface Vec2 {
  x: number
  y: number
}

/** A read-only view, for parameters a function promises not to mutate. */
export type ReadonlyVec2 = Readonly<Vec2>

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y }
}

export function clone(v: ReadonlyVec2): Vec2 {
  return { x: v.x, y: v.y }
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x
  out.y = y
  return out
}

export function copy(out: Vec2, v: ReadonlyVec2): Vec2 {
  out.x = v.x
  out.y = v.y
  return out
}

export function add(a: ReadonlyVec2, b: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
  out.x = a.x + b.x
  out.y = a.y + b.y
  return out
}

export function sub(a: ReadonlyVec2, b: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
  out.x = a.x - b.x
  out.y = a.y - b.y
  return out
}

export function scale(v: ReadonlyVec2, s: number, out: Vec2 = vec2()): Vec2 {
  out.x = v.x * s
  out.y = v.y * s
  return out
}

/** `out = a + b * s` — the fused step used by every integrator here. */
export function addScaled(
  a: ReadonlyVec2,
  b: ReadonlyVec2,
  s: number,
  out: Vec2 = vec2(),
): Vec2 {
  out.x = a.x + b.x * s
  out.y = a.y + b.y * s
  return out
}

export function negate(v: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
  out.x = -v.x
  out.y = -v.y
  return out
}

export function dot(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return a.x * b.x + a.y * b.y
}

/** 2D analogue of the cross product: the z component of a 3D cross. */
export function cross(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return a.x * b.y - a.y * b.x
}

export function length(v: ReadonlyVec2): number {
  return Math.hypot(v.x, v.y)
}

/** Squared length — prefer this for comparisons to avoid the sqrt. */
export function lengthSq(v: ReadonlyVec2): number {
  return v.x * v.x + v.y * v.y
}

export function distance(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function distanceSq(a: ReadonlyVec2, b: ReadonlyVec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
}

/** Normalise to unit length. A zero vector stays zero rather than becoming NaN. */
export function normalize(v: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
  const len = Math.hypot(v.x, v.y)
  if (len === 0) {
    out.x = 0
    out.y = 0
    return out
  }
  out.x = v.x / len
  out.y = v.y / len
  return out
}

/** Clamp a vector's magnitude without changing its direction. */
export function limit(v: ReadonlyVec2, max: number, out: Vec2 = vec2()): Vec2 {
  const lenSq = v.x * v.x + v.y * v.y
  if (lenSq <= max * max || lenSq === 0) {
    out.x = v.x
    out.y = v.y
    return out
  }
  const s = max / Math.sqrt(lenSq)
  out.x = v.x * s
  out.y = v.y * s
  return out
}

export function lerpVec(
  a: ReadonlyVec2,
  b: ReadonlyVec2,
  t: number,
  out: Vec2 = vec2(),
): Vec2 {
  out.x = lerp(a.x, b.x, t)
  out.y = lerp(a.y, b.y, t)
  return out
}

/** Rotate by `radians` around the origin. */
export function rotate(v: ReadonlyVec2, radians: number, out: Vec2 = vec2()): Vec2 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const x = v.x * c - v.y * s
  const y = v.x * s + v.y * c
  out.x = x
  out.y = y
  return out
}

/** Rotate around an arbitrary pivot. */
export function rotateAround(
  v: ReadonlyVec2,
  pivot: ReadonlyVec2,
  radians: number,
  out: Vec2 = vec2(),
): Vec2 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const dx = v.x - pivot.x
  const dy = v.y - pivot.y
  out.x = pivot.x + dx * c - dy * s
  out.y = pivot.y + dx * s + dy * c
  return out
}

/** Rotate 90 degrees counter-clockwise — the left-hand normal. */
export function perpendicular(v: ReadonlyVec2, out: Vec2 = vec2()): Vec2 {
  const x = v.x
  out.x = -v.y
  out.y = x
  return out
}

/** The angle of the vector, in (-PI, PI]. */
export function angle(v: ReadonlyVec2): number {
  return Math.atan2(v.y, v.x)
}

/** A unit vector pointing along `radians`. */
export function fromAngle(radians: number, len = 1, out: Vec2 = vec2()): Vec2 {
  out.x = Math.cos(radians) * len
  out.y = Math.sin(radians) * len
  return out
}

/** Shortest signed angle from `a` to `b`. */
export function angleBetween(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return wrapAngle(Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x))
}

export function equals(a: ReadonlyVec2, b: ReadonlyVec2, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

export function isZero(v: ReadonlyVec2, epsilon = 1e-6): boolean {
  return Math.abs(v.x) <= epsilon && Math.abs(v.y) <= epsilon
}

/**
 * Closest point to `p` on the segment `a`->`b`, plus the parametric `t` along
 * the segment. Used constantly for snapping vehicles to roads and for
 * proximity tests against road edges.
 */
export function closestPointOnSegment(
  p: ReadonlyVec2,
  a: ReadonlyVec2,
  b: ReadonlyVec2,
  out: Vec2 = vec2(),
): { point: Vec2; t: number } {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby

  if (lenSq === 0) {
    out.x = a.x
    out.y = a.y
    return { point: out, t: 0 }
  }

  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq, 0, 1)
  out.x = a.x + abx * t
  out.y = a.y + aby * t
  return { point: out, t }
}

/** Perpendicular distance from `p` to the segment `a`->`b`. */
export function distanceToSegment(
  p: ReadonlyVec2,
  a: ReadonlyVec2,
  b: ReadonlyVec2,
): number {
  const { point } = closestPointOnSegment(p, a, b, TMP_SEGMENT)
  return distance(p, point)
}

/** Catmull-Rom interpolation through four control points — used for road splines. */
export function catmullRom(
  p0: ReadonlyVec2,
  p1: ReadonlyVec2,
  p2: ReadonlyVec2,
  p3: ReadonlyVec2,
  t: number,
  out: Vec2 = vec2(),
): Vec2 {
  const t2 = t * t
  const t3 = t2 * t
  out.x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
  out.y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  return out
}

/** Quadratic Bezier — cheap curves for particle arcs and UI paths. */
export function quadraticBezier(
  p0: ReadonlyVec2,
  p1: ReadonlyVec2,
  p2: ReadonlyVec2,
  t: number,
  out: Vec2 = vec2(),
): Vec2 {
  const inv = 1 - t
  const a = inv * inv
  const b = 2 * inv * t
  const c = t * t
  out.x = a * p0.x + b * p1.x + c * p2.x
  out.y = a * p0.y + b * p1.y + c * p2.y
  return out
}

/** A point on a circle at `radians`, radius `r`, centred on `center`. */
export function onCircle(
  center: ReadonlyVec2,
  r: number,
  radians: number,
  out: Vec2 = vec2(),
): Vec2 {
  out.x = center.x + Math.cos(radians) * r
  out.y = center.y + Math.sin(radians) * r
  return out
}

export const ZERO: ReadonlyVec2 = Object.freeze({ x: 0, y: 0 })
export const ONE: ReadonlyVec2 = Object.freeze({ x: 1, y: 1 })
export const UP: ReadonlyVec2 = Object.freeze({ x: 0, y: -1 })
export const DOWN: ReadonlyVec2 = Object.freeze({ x: 0, y: 1 })
export const LEFT: ReadonlyVec2 = Object.freeze({ x: -1, y: 0 })
export const RIGHT: ReadonlyVec2 = Object.freeze({ x: 1, y: 0 })

/** Scratch vector owned by {@link distanceToSegment}. Never returned to callers. */
const TMP_SEGMENT: Vec2 = vec2()

export { TAU }
