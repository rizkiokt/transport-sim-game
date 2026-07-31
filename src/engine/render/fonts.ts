/**
 * Font handling for Canvas2D text.
 *
 * Canvas is unforgiving about fonts: if you set `ctx.font` to a family the
 * browser has not finished loading, it silently substitutes a fallback and
 * never repaints when the real font arrives. Unlike DOM text, there is no
 * automatic swap. So anything drawing text has to either wait for the font or
 * accept that the first seconds render in the wrong typeface.
 *
 * {@link ensureFontsReady} is the wait, and it is deliberately fail-safe: a
 * missing or slow font must never prevent the game from starting.
 */

/** The display family, matching the `@font-face` declared in index.html. */
export const DISPLAY_FONT = "'Fredoka', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

/** Monospace stack for the debug overlay. */
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/**
 * Build a `ctx.font` string.
 *
 * @param size in CSS pixels
 * @param weight 300-700; Fredoka is variable across that range
 */
export function font(size: number, weight = 600, family = DISPLAY_FONT): string {
  return `${weight} ${Math.round(size)}px ${family}`
}

/**
 * Resolve once the display font is usable, or after `timeoutMs`, whichever
 * comes first.
 *
 * The timeout matters: `document.fonts.ready` can hang indefinitely if a font
 * request stalls, and a child staring at a blank screen because a typeface did
 * not arrive is a far worse outcome than a few seconds of fallback text.
 */
export async function ensureFontsReady(timeoutMs = 2500): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false

  const timeout = new Promise<false>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs)
  })

  const load = (async (): Promise<boolean> => {
    try {
      // Explicitly request the weights we draw with. `fonts.ready` alone only
      // waits for fonts already triggered by rendered DOM text, and the game
      // draws entirely to canvas — so nothing would trigger the load at all.
      await Promise.all([
        document.fonts.load(`400 16px 'Fredoka'`),
        document.fonts.load(`600 16px 'Fredoka'`),
        document.fonts.load(`700 16px 'Fredoka'`),
      ])
      await document.fonts.ready
      return document.fonts.check(`700 16px 'Fredoka'`)
    } catch {
      // A font failure is cosmetic; carry on with the fallback stack.
      return false
    }
  })()

  return Promise.race([load, timeout])
}

/**
 * Measure text and return the largest font size that fits `maxWidth`.
 *
 * Used for titles and any label whose content can change length — a longer
 * name must shrink rather than run off the edge of a narrow tablet.
 *
 * @param preferredSize the size to use when the text already fits
 * @param minSize never shrink below this, even if it still overflows
 */
export function fitTextSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferredSize: number,
  weight = 600,
  family = DISPLAY_FONT,
  minSize = 10,
): number {
  ctx.font = font(preferredSize, weight, family)
  const width = ctx.measureText(text).width
  if (width <= maxWidth || width === 0) return preferredSize
  return Math.max(minSize, Math.floor(preferredSize * (maxWidth / width)))
}
