import { describe, expect, it } from 'vitest'

import {
  alpha,
  blue,
  clearCssCache,
  contrastRatio,
  darken,
  fade,
  fromHex,
  fromHsl,
  grade,
  green,
  lighten,
  luminance,
  mix,
  readableInk,
  red,
  rgba,
  shiftHue,
  toCss,
  toHex,
  toHsl,
  vary,
  withAlpha,
} from './color.js'

describe('color packing', () => {
  it('round-trips channels', () => {
    const c = rgba(12, 34, 56, 78)
    expect(red(c)).toBe(12)
    expect(green(c)).toBe(34)
    expect(blue(c)).toBe(56)
    expect(alpha(c)).toBe(78)
  })

  it('stays a positive 32-bit value even at full white', () => {
    // A signed-shift bug here yields a negative number and breaks Map keys.
    const c = rgba(255, 255, 255, 255)
    expect(c).toBeGreaterThan(0)
    expect(red(c)).toBe(255)
    expect(alpha(c)).toBe(255)
  })

  it('clamps out-of-range channels', () => {
    const c = rgba(-50, 300, 128.6)
    expect(red(c)).toBe(0)
    expect(green(c)).toBe(255)
    expect(blue(c)).toBe(129)
  })
})

describe('hex parsing', () => {
  it('parses 6-digit hex', () => {
    const c = fromHex('#ff8800')
    expect(red(c)).toBe(255)
    expect(green(c)).toBe(136)
    expect(blue(c)).toBe(0)
    expect(alpha(c)).toBe(255)
  })

  it('parses shorthand and 8-digit forms', () => {
    expect(fromHex('#f80')).toBe(fromHex('#ff8800'))
    expect(alpha(fromHex('#ff880080'))).toBe(128)
    expect(alpha(fromHex('#f808'))).toBe(136)
  })

  it('tolerates a missing leading hash', () => {
    expect(fromHex('ff8800')).toBe(fromHex('#ff8800'))
  })

  it('throws on malformed input rather than silently returning black', () => {
    expect(() => fromHex('#gggggg')).toThrow()
    expect(() => fromHex('#ff888')).toThrow() // 5 digits is not a valid length
    expect(() => fromHex('#ff')).toThrow()
    expect(() => fromHex('')).toThrow()
  })

  it('round-trips through toHex', () => {
    expect(toHex(fromHex('#3a7bd5'))).toBe('#3a7bd5')
    expect(toHex(fromHex('#3a7bd580'), true)).toBe('#3a7bd580')
  })
})

describe('css output', () => {
  it('emits hex when opaque and rgba when translucent', () => {
    clearCssCache()
    expect(toCss(fromHex('#3a7bd5'))).toBe('#3a7bd5')
    expect(toCss(withAlpha(fromHex('#3a7bd5'), 0.5))).toMatch(/^rgba\(58,123,213,0\.5/)
  })

  it('returns the same string for repeated calls', () => {
    clearCssCache()
    const c = fromHex('#123456')
    expect(toCss(c)).toBe(toCss(c))
  })
})

describe('alpha helpers', () => {
  it('accepts both 0..1 and 0..255 alpha', () => {
    expect(alpha(withAlpha(fromHex('#fff'), 0.5))).toBe(128)
    expect(alpha(withAlpha(fromHex('#fff'), 200))).toBe(200)
    // 1 is ambiguous; treated as fully opaque, which is the useful reading.
    expect(alpha(withAlpha(fromHex('#fff'), 1))).toBe(255)
  })

  it('fades relative to existing alpha', () => {
    const half = withAlpha(fromHex('#fff'), 0.5)
    expect(alpha(fade(half, 0.5))).toBe(64)
  })
})

describe('mixing and shading', () => {
  it('mixes endpoints exactly', () => {
    const a = fromHex('#000000')
    const b = fromHex('#ffffff')
    expect(mix(a, b, 0)).toBe(a)
    expect(mix(a, b, 1)).toBe(b)
    expect(red(mix(a, b, 0.5))).toBe(128)
  })

  it('clamps the mix factor', () => {
    const a = fromHex('#000000')
    const b = fromHex('#ffffff')
    expect(mix(a, b, -5)).toBe(a)
    expect(mix(a, b, 5)).toBe(b)
  })

  it('lightens and darkens monotonically', () => {
    const base = fromHex('#3a7bd5')
    expect(luminance(lighten(base, 0.3))).toBeGreaterThan(luminance(base))
    expect(luminance(darken(base, 0.3))).toBeLessThan(luminance(base))
  })

  it('preserves alpha through lighten and darken', () => {
    const base = withAlpha(fromHex('#3a7bd5'), 0.5)
    expect(alpha(lighten(base, 0.3))).toBe(128)
    expect(alpha(darken(base, 0.3))).toBe(128)
  })
})

describe('hsl', () => {
  it('round-trips a saturated colour', () => {
    const original = fromHex('#3a7bd5')
    const { h, s, l } = toHsl(original)
    const restored = fromHsl(h, s, l)
    expect(Math.abs(red(restored) - red(original))).toBeLessThanOrEqual(1)
    expect(Math.abs(green(restored) - green(original))).toBeLessThanOrEqual(1)
    expect(Math.abs(blue(restored) - blue(original))).toBeLessThanOrEqual(1)
  })

  it('handles greys, where hue is undefined', () => {
    const grey = fromHex('#808080')
    const { s } = toHsl(grey)
    expect(s).toBe(0)
    const restored = fromHsl(0, 0, 0.5)
    expect(red(restored)).toBe(green(restored))
    expect(green(restored)).toBe(blue(restored))
  })

  it('wraps hue rotation past 360', () => {
    const base = fromHex('#ff0000')
    expect(toHex(shiftHue(base, 360))).toBe(toHex(base))
    expect(toHex(shiftHue(base, -360))).toBe(toHex(base))
  })

  it('shifts hue to a different colour', () => {
    const red120 = shiftHue(fromHex('#ff0000'), 120)
    // Red rotated 120deg is green.
    expect(green(red120)).toBeGreaterThan(200)
    expect(red(red120)).toBeLessThan(50)
  })
})

describe('contrast', () => {
  it('computes the standard black/white ratio', () => {
    const ratio = contrastRatio(fromHex('#000000'), fromHex('#ffffff'))
    expect(ratio).toBeCloseTo(21, 1)
  })

  it('is symmetric', () => {
    const a = fromHex('#3a7bd5')
    const b = fromHex('#ffd166')
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a))
  })

  it('picks the more readable ink for a background', () => {
    const white = fromHex('#ffffff')
    const black = fromHex('#000000')
    expect(readableInk(fromHex('#111111'), white, black)).toBe(white)
    expect(readableInk(fromHex('#f5f5f5'), white, black)).toBe(black)
  })
})

describe('grading and variation', () => {
  it('leaves colour untouched at zero strength', () => {
    const base = fromHex('#3a7bd5')
    expect(grade(base, fromHex('#ff0000'), 0)).toBe(base)
  })

  it('fully replaces colour at full strength', () => {
    const tint = fromHex('#ff0000')
    const graded = grade(fromHex('#3a7bd5'), tint, 1)
    expect(red(graded)).toBe(255)
    expect(green(graded)).toBe(0)
  })

  it('darkens via the brightness multiplier', () => {
    const base = fromHex('#808080')
    const night = grade(base, fromHex('#001133'), 0.3, 0.5)
    expect(luminance(night)).toBeLessThan(luminance(base))
  })

  it('varies deterministically around a base colour', () => {
    const base = fromHex('#c94f4f')
    expect(vary(base, 0.5)).toBe(vary(base, 0.5))
    // The extremes must actually differ, or a street of buildings looks flat.
    expect(vary(base, 0)).not.toBe(vary(base, 1))
  })

  it('keeps variation recognisably related to the base hue', () => {
    const base = fromHex('#c94f4f')
    const baseHue = toHsl(base).h
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const varied = toHsl(vary(base, v, 12)).h
      // Shortest arc between the two hues, accounting for wraparound at 360.
      const delta = Math.abs(((varied - baseHue + 540) % 360) - 180)
      expect(delta).toBeLessThanOrEqual(13)
    }
  })
})
