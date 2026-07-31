import { describe, expect, it } from 'vitest'

import {
  angleDelta,
  clamp,
  damp,
  lerp,
  lerpAngle,
  mod,
  moveTowards,
  remapClamped,
  springDamp,
  wrapAngle,
} from './scalar.js'
import { createRng, hashString, valueNoise2D } from './rng.js'
import * as V from './vec2.js'

describe('scalar', () => {
  it('clamps to the given range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('lerps between endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.25)).toBe(2.5)
  })

  it('remaps and clamps out-of-range inputs', () => {
    expect(remapClamped(5, 0, 10, 0, 100)).toBe(50)
    expect(remapClamped(-5, 0, 10, 0, 100)).toBe(0)
    expect(remapClamped(50, 0, 10, 0, 100)).toBe(100)
  })

  it('uses euclidean modulo so negatives wrap positively', () => {
    expect(mod(-1, 4)).toBe(3)
    expect(mod(5, 4)).toBe(1)
    expect(mod(-5, 4)).toBe(3)
  })

  it('wraps angles into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBeCloseTo(0)
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0)
    expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2)

    // The half-open end: PI and -PI are the same angle, and both land on -PI.
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI)
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI)

    // Whatever the endpoint convention, the result must always be in range.
    for (let a = -20; a < 20; a += 0.37) {
      const wrapped = wrapAngle(a)
      expect(wrapped).toBeGreaterThanOrEqual(-Math.PI)
      expect(wrapped).toBeLessThan(Math.PI)
      // And must represent the same direction as the input.
      expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(a))
      expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(a))
    }
  })

  it('takes the short way around when comparing angles', () => {
    // 350deg -> 10deg is +20deg, not -340deg. This is the bug that makes a
    // car spin the long way when crossing due-east.
    const from = (350 * Math.PI) / 180
    const to = (10 * Math.PI) / 180
    expect(angleDelta(from, to)).toBeCloseTo((20 * Math.PI) / 180)
  })

  it('interpolates angles along the short arc', () => {
    const from = (350 * Math.PI) / 180
    const to = (10 * Math.PI) / 180
    const mid = lerpAngle(from, to, 0.5)
    // Halfway should be 0deg, not 180deg.
    expect(Math.abs(wrapAngle(mid))).toBeLessThan(0.01)
  })

  it('moves toward a target without overshooting', () => {
    expect(moveTowards(0, 10, 3)).toBe(3)
    expect(moveTowards(0, 10, 100)).toBe(10)
    expect(moveTowards(10, 0, 100)).toBe(0)
  })

  it('damps at the same wall-clock rate regardless of step size', () => {
    // The whole point of damp() over a raw lerp: one big step and many small
    // steps covering the same time must land in the same place.
    const smoothing = 0.05
    const totalTime = 1

    let coarse = 0
    coarse = damp(coarse, 100, smoothing, totalTime)

    let fine = 0
    const steps = 120
    for (let i = 0; i < steps; i++) {
      fine = damp(fine, 100, smoothing, totalTime / steps)
    }

    expect(fine).toBeCloseTo(coarse, 5)
  })

  it('settles a spring on its target', () => {
    const velocity = { value: 0 }
    let position = 0
    for (let i = 0; i < 240; i++) {
      position = springDamp(position, 100, velocity, 0.2, 1 / 60)
    }
    expect(position).toBeCloseTo(100, 1)
    expect(Math.abs(velocity.value)).toBeLessThan(0.5)
  })
})

describe('vec2', () => {
  it('computes length and distance', () => {
    expect(V.length({ x: 3, y: 4 })).toBe(5)
    expect(V.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(V.lengthSq({ x: 3, y: 4 })).toBe(25)
  })

  it('normalises a zero vector to zero rather than NaN', () => {
    const result = V.normalize({ x: 0, y: 0 })
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })

  it('limits magnitude without changing direction', () => {
    const limited = V.limit({ x: 30, y: 40 }, 5)
    expect(V.length(limited)).toBeCloseTo(5)
    expect(limited.x / limited.y).toBeCloseTo(30 / 40)
  })

  it('rotates around the origin', () => {
    const rotated = V.rotate({ x: 1, y: 0 }, Math.PI / 2)
    expect(rotated.x).toBeCloseTo(0)
    expect(rotated.y).toBeCloseTo(1)
  })

  it('writes into an out parameter without allocating', () => {
    const out = V.vec2()
    const result = V.add({ x: 1, y: 2 }, { x: 3, y: 4 }, out)
    expect(result).toBe(out)
    expect(out).toEqual({ x: 4, y: 6 })
  })

  it('finds the closest point on a segment, clamped to its ends', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }

    const middle = V.closestPointOnSegment({ x: 5, y: 5 }, a, b)
    expect(middle.point.x).toBeCloseTo(5)
    expect(middle.point.y).toBeCloseTo(0)
    expect(middle.t).toBeCloseTo(0.5)

    // Past the end should clamp to the endpoint, not extrapolate.
    const past = V.closestPointOnSegment({ x: 50, y: 5 }, a, b)
    expect(past.point.x).toBeCloseTo(10)
    expect(past.t).toBe(1)

    const before = V.closestPointOnSegment({ x: -50, y: 5 }, a, b)
    expect(before.point.x).toBeCloseTo(0)
    expect(before.t).toBe(0)
  })

  it('handles a degenerate zero-length segment', () => {
    const a = { x: 3, y: 3 }
    const result = V.closestPointOnSegment({ x: 10, y: 10 }, a, a)
    expect(result.point).toEqual({ x: 3, y: 3 })
    expect(Number.isNaN(result.t)).toBe(false)
  })
})

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it('produces different streams for different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    const aVals = Array.from({ length: 20 }, () => a.next())
    const bVals = Array.from({ length: 20 }, () => b.next())
    expect(aVals).not.toEqual(bVals)
  })

  it('accepts string seeds so world regions can be named', () => {
    const a = createRng('harbour-district')
    const b = createRng('harbour-district')
    expect(a.next()).toBe(b.next())
    expect(createRng('harbour-district').seed).toBe(hashString('harbour-district'))
  })

  it('stays within [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 5000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('produces integers across the full inclusive range', () => {
    const rng = createRng(99)
    const seen = new Set<number>()
    for (let i = 0; i < 3000; i++) {
      const v = rng.int(1, 6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      seen.add(v)
    }
    // Every face of a d6 should turn up in 3000 rolls.
    expect(seen.size).toBe(6)
  })

  it('respects weights, including zero-weight entries', () => {
    const rng = createRng(3)
    const counts = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 4000; i++) {
      const pick = rng.pickWeighted(['a', 'b', 'c'] as const, [10, 1, 0])
      counts[pick]++
    }
    expect(counts.c).toBe(0)
    expect(counts.a).toBeGreaterThan(counts.b * 4)
  })

  it('shuffles without losing or duplicating elements', () => {
    const rng = createRng(4)
    const items = Array.from({ length: 50 }, (_, i) => i)
    const shuffled = rng.shuffle([...items])
    expect(shuffled).toHaveLength(50)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
  })

  it('forks into independent but reproducible streams', () => {
    const parentA = createRng(42)
    const parentB = createRng(42)
    const forkA = parentA.fork('trees')
    const forkB = parentB.fork('trees')
    expect(forkA.next()).toBe(forkB.next())

    // Two differently-labelled forks must not correlate.
    const trees = createRng(42).fork('trees')
    const rocks = createRng(42).fork('rocks')
    expect(trees.next()).not.toBe(rocks.next())
  })

  it('keeps insideCircle inside the unit circle', () => {
    const rng = createRng(11)
    for (let i = 0; i < 2000; i++) {
      const p = rng.insideCircle()
      expect(p.x * p.x + p.y * p.y).toBeLessThanOrEqual(1)
    }
  })

  it('generates smooth, repeatable 2D noise', () => {
    expect(valueNoise2D(1.5, 2.5, 7)).toBe(valueNoise2D(1.5, 2.5, 7))
    // Neighbouring samples should be close — that is what makes it "smooth".
    const a = valueNoise2D(1.5, 2.5, 7)
    const b = valueNoise2D(1.51, 2.5, 7)
    expect(Math.abs(a - b)).toBeLessThan(0.1)
  })
})
