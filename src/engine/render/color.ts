/**
 * Colour manipulation for procedural art.
 *
 * Every surface in this game is drawn, not textured, so colour does the work
 * that art assets normally would: one car-body shape becomes twelve different
 * vehicles through paint, and one building shape becomes a whole street
 * through hue variation. Shading (the lighter top face, the darker side) is
 * derived from a single base colour rather than authored, which keeps content
 * data tiny and makes a global day/night grade possible.
 *
 * Colours are stored packed in a single 32-bit integer (0xRRGGBBAA) so they
 * can be manipulated arithmetically without string parsing, and converted to
 * a CSS string only at draw time — where the result is cached, because
 * building `rgba(...)` strings per frame is a real cost in Canvas2D.
 */

import { clamp01, lerp } from '../math/scalar.js'

/** Packed 0xRRGGBBAA. */
export type Rgba = number

const CSS_CACHE = new Map<Rgba, string>()
/**
 * Bound the cache. Day/night grading generates a continuum of colours, so an
 * unbounded cache would grow without limit over a long session.
 */
const CSS_CACHE_LIMIT = 4096

export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return (
    ((clampByte(r) << 24) | (clampByte(g) << 16) | (clampByte(b) << 8) | clampByte(a)) >>> 0
  )
}

export function red(color: Rgba): number {
  return (color >>> 24) & 0xff
}

export function green(color: Rgba): number {
  return (color >>> 16) & 0xff
}

export function blue(color: Rgba): number {
  return (color >>> 8) & 0xff
}

export function alpha(color: Rgba): number {
  return color & 0xff
}

/**
 * Parse `#rgb`, `#rrggbb`, or `#rrggbbaa`. Throws on anything else — content
 * data is authored by hand, and a silent black fallback would be a nightmare
 * to track down in a city of 200 buildings.
 */
export function fromHex(hex: string): Rgba {
  let s = hex.trim()
  if (s.startsWith('#')) s = s.slice(1)

  if (s.length === 3 || s.length === 4) {
    const r = parseInt(s[0]! + s[0]!, 16)
    const g = parseInt(s[1]! + s[1]!, 16)
    const b = parseInt(s[2]! + s[2]!, 16)
    const a = s.length === 4 ? parseInt(s[3]! + s[3]!, 16) : 255
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
      throw new Error(`fromHex: not a valid colour: "${hex}"`)
    }
    return rgba(r, g, b, a)
  }

  if (s.length === 6 || s.length === 8) {
    const r = parseInt(s.slice(0, 2), 16)
    const g = parseInt(s.slice(2, 4), 16)
    const b = parseInt(s.slice(4, 6), 16)
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
      throw new Error(`fromHex: not a valid colour: "${hex}"`)
    }
    return rgba(r, g, b, a)
  }

  throw new Error(`fromHex: not a valid colour: "${hex}"`)
}

export function toHex(color: Rgba, includeAlpha = false): string {
  const r = red(color).toString(16).padStart(2, '0')
  const g = green(color).toString(16).padStart(2, '0')
  const b = blue(color).toString(16).padStart(2, '0')
  if (!includeAlpha) return `#${r}${g}${b}`
  return `#${r}${g}${b}${alpha(color).toString(16).padStart(2, '0')}`
}

/**
 * A CSS colour string suitable for `fillStyle`. Cached, because this is called
 * thousands of times per frame and string construction shows up in profiles.
 */
export function toCss(color: Rgba): string {
  const cached = CSS_CACHE.get(color)
  if (cached !== undefined) return cached

  const a = alpha(color)
  const css =
    a === 255
      ? `#${toHexPair(red(color))}${toHexPair(green(color))}${toHexPair(blue(color))}`
      : `rgba(${red(color)},${green(color)},${blue(color)},${(a / 255).toFixed(3)})`

  if (CSS_CACHE.size >= CSS_CACHE_LIMIT) CSS_CACHE.clear()
  CSS_CACHE.set(color, css)
  return css
}

export function withAlpha(color: Rgba, a: number): Rgba {
  // Accept both 0..1 and 0..255, since both are natural to write.
  const byte = a <= 1 ? Math.round(a * 255) : Math.round(a)
  return ((color & 0xffffff00) | clampByte(byte)) >>> 0
}

/** Multiply the existing alpha, for fading something already translucent. */
export function fade(color: Rgba, factor: number): Rgba {
  return withAlpha(color, Math.round(alpha(color) * clamp01(factor)))
}

/** Blend two colours. `t` of 0 returns `a`, 1 returns `b`. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = clamp01(t)
  return rgba(
    lerp(red(a), red(b), k),
    lerp(green(a), green(b), k),
    lerp(blue(a), blue(b), k),
    lerp(alpha(a), alpha(b), k),
  )
}

/** Move a colour toward white. */
export function lighten(color: Rgba, amount: number): Rgba {
  return mix(color, rgba(255, 255, 255, alpha(color)), amount)
}

/** Move a colour toward black. */
export function darken(color: Rgba, amount: number): Rgba {
  return mix(color, rgba(0, 0, 0, alpha(color)), amount)
}

/**
 * Shade for a lit surface.
 *
 * Naively lightening toward pure white desaturates and looks chalky, which is
 * exactly the "cheap procedural art" tell we want to avoid. Shifting in HSL
 * instead keeps the hue rich, so a red car's highlight stays red rather than
 * turning pink-grey.
 */
export function shade(color: Rgba, amount: number): Rgba {
  const { h, s, l } = toHsl(color)
  // Warm the highlights slightly and cool the shadows — a classic trick that
  // makes flat colour read as lit form.
  const hueShift = amount > 0 ? -3 : 6
  return fromHsl(
    h + hueShift * Math.abs(amount),
    clamp01(s * (amount > 0 ? 1.02 : 0.94)),
    clamp01(l + amount),
    alpha(color),
  )
}

export interface Hsl {
  /** Degrees, 0..360. */
  h: number
  /** 0..1 */
  s: number
  /** 0..1 */
  l: number
}

export function toHsl(color: Rgba): Hsl {
  const r = red(color) / 255
  const g = green(color) / 255
  const b = blue(color) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6

  return { h: h * 360, s, l }
}

export function fromHsl(h: number, s: number, l: number, a = 255): Rgba {
  const hue = (((h % 360) + 360) % 360) / 360
  const sat = clamp01(s)
  const light = clamp01(l)

  if (sat === 0) {
    const v = Math.round(light * 255)
    return rgba(v, v, v, a)
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
  const p = 2 * light - q

  return rgba(
    hueToRgb(p, q, hue + 1 / 3) * 255,
    hueToRgb(p, q, hue) * 255,
    hueToRgb(p, q, hue - 1 / 3) * 255,
    a,
  )
}

function hueToRgb(p: number, q: number, t: number): number {
  let k = t
  if (k < 0) k += 1
  if (k > 1) k -= 1
  if (k < 1 / 6) return p + (q - p) * 6 * k
  if (k < 1 / 2) return q
  if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6
  return p
}

/** Rotate hue, e.g. to vary a row of buildings off one base colour. */
export function shiftHue(color: Rgba, degrees: number): Rgba {
  const { h, s, l } = toHsl(color)
  return fromHsl(h + degrees, s, l, alpha(color))
}

export function saturate(color: Rgba, amount: number): Rgba {
  const { h, s, l } = toHsl(color)
  return fromHsl(h, clamp01(s + amount), l, alpha(color))
}

export function desaturate(color: Rgba, amount: number): Rgba {
  return saturate(color, -amount)
}

/**
 * Relative luminance, per WCAG. Used to decide whether text or an icon drawn
 * on this colour should be black or white — important because a 6-year-old
 * reads icons by silhouette, and a low-contrast icon simply disappears.
 */
export function luminance(color: Rgba): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(red(color)) + 0.7152 * channel(green(color)) + 0.0722 * channel(blue(color))
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Whichever of black or white reads more clearly on `background`. */
export function readableInk(background: Rgba, light: Rgba, dark: Rgba): Rgba {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark
}

/**
 * Apply a global colour grade — the mechanism behind day/night and weather.
 *
 * @param tint colour to push toward
 * @param strength 0 = untouched, 1 = fully the tint
 * @param brightness multiplier applied first
 */
export function grade(color: Rgba, tint: Rgba, strength: number, brightness = 1): Rgba {
  const r = red(color) * brightness
  const g = green(color) * brightness
  const b = blue(color) * brightness
  const k = clamp01(strength)
  return rgba(
    lerp(r, red(tint), k),
    lerp(g, green(tint), k),
    lerp(b, blue(tint), k),
    alpha(color),
  )
}

/**
 * Deterministically vary a colour, so a street of identical building shapes
 * reads as a street of different buildings.
 *
 * @param variation 0..1 unit value (typically from hashed noise)
 * @param hueRange degrees of hue swing
 * @param lightRange lightness swing
 */
export function vary(
  color: Rgba,
  variation: number,
  hueRange = 12,
  lightRange = 0.08,
): Rgba {
  const signed = variation * 2 - 1
  const { h, s, l } = toHsl(color)
  return fromHsl(h + signed * hueRange, s, clamp01(l + signed * lightRange), alpha(color))
}

function clampByte(v: number): number {
  const n = Math.round(v)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

function toHexPair(v: number): string {
  return v.toString(16).padStart(2, '0')
}

/** Clear the CSS string cache. Exposed for tests. */
export function clearCssCache(): void {
  CSS_CACHE.clear()
}
