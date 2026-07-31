/**
 * Destination symbols — the game's text-free "address" system.
 *
 * Every ride is tagged with a shape+colour pair. The passenger holds up a
 * bubble showing it, and the destination pin shows the same one, so the
 * child's job is simply "take the star person to the star place". Shape and
 * colour are redundant with each other on purpose: a colour-blind player
 * matches on shape alone.
 */

import { toCss, type Rgba } from '../../engine/render/color.js'
import { circle, heart, mapPin, polygon, roundRectCentered, softStar, speechBubble } from '../../engine/render/shapes.js'
import { PALETTE, SYMBOL_COLORS } from '../config/palette.js'
import { createRng } from '../../engine/math/rng.js'

export type SymbolShape = 'star' | 'heart' | 'circle' | 'triangle' | 'square'

const SHAPES: readonly SymbolShape[] = ['star', 'heart', 'circle', 'triangle', 'square']

export interface RideSymbol {
  shape: SymbolShape
  color: Rgba
}

/** Roll a symbol; shape and colour indices are linked so pairs stay distinct. */
export function rollSymbol(seed: number | string): RideSymbol {
  const rng = createRng(`symbol:${seed}`)
  const index = rng.int(0, SHAPES.length - 1)
  return { shape: SHAPES[index]!, color: SYMBOL_COLORS[index % SYMBOL_COLORS.length]! }
}

/** Draw the bare symbol centred on the origin, `size` = half-extent. */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: RideSymbol,
  size: number,
): void {
  ctx.fillStyle = toCss(symbol.color)
  switch (symbol.shape) {
    case 'star':
      softStar(ctx, 0, 0, size, size * 0.5)
      ctx.fill()
      break
    case 'heart':
      heart(ctx, 0, -size * 0.1, size * 0.75)
      ctx.fill()
      break
    case 'circle':
      circle(ctx, 0, 0, size * 0.85)
      ctx.fill()
      break
    case 'triangle':
      polygon(ctx, 0, size * 0.05, size, 3)
      ctx.fill()
      break
    case 'square':
      roundRectCentered(ctx, 0, 0, size * 1.5, size * 1.5, size * 0.3)
      ctx.fill()
      break
  }
}

/**
 * The thought bubble a waiting passenger shows: white bubble, symbol inside.
 * Origin is the bubble centre; the tail points down toward the speaker.
 */
export function drawSymbolBubble(
  ctx: CanvasRenderingContext2D,
  symbol: RideSymbol,
  size: number,
): void {
  ctx.fillStyle = toCss(PALETTE.uiPanelLight)
  ctx.strokeStyle = toCss(PALETTE.uiInk)
  ctx.lineWidth = size * 0.12
  speechBubble(ctx, 0, 0, size * 2.4, size * 2, size * 0.7, size * 0.5)
  ctx.fill()
  ctx.stroke()

  drawSymbol(ctx, symbol, size * 0.62)
}

/**
 * The destination marker: a map pin carrying the symbol, with a pulsing
 * ground ring. `pulse` is 0..1 and drives the ring's expansion.
 */
export function drawDestinationPin(
  ctx: CanvasRenderingContext2D,
  symbol: RideSymbol,
  height: number,
  pulse: number,
  bob: number,
): void {
  const width = height * 0.62

  // Ground ring, expanding and fading with the pulse.
  const ringR = width * (0.5 + pulse * 0.9)
  ctx.strokeStyle = toCss(symbol.color)
  ctx.globalAlpha = (1 - pulse) * 0.7
  ctx.lineWidth = 4
  circle(ctx, 0, 0, ringR)
  ctx.stroke()
  ctx.globalAlpha = 1

  // Landing dot.
  ctx.fillStyle = toCss(symbol.color)
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.ellipse(0, 0, width * 0.34, width * 0.16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.save()
  ctx.translate(0, bob)

  ctx.fillStyle = toCss(symbol.color)
  ctx.strokeStyle = toCss(PALETTE.uiInkLight)
  ctx.lineWidth = height * 0.05
  mapPin(ctx, 0, 0, width, height)
  ctx.fill()
  ctx.stroke()

  // Symbol sits in the pin's round head, drawn knocked-out white for contrast.
  ctx.translate(0, -height + width / 2)
  ctx.fillStyle = toCss(PALETTE.uiInkLight)
  drawSymbolSilhouette(ctx, symbol, width * 0.3)

  ctx.restore()
}

/** The symbol drawn in whatever fillStyle is current (for knockouts). */
function drawSymbolSilhouette(
  ctx: CanvasRenderingContext2D,
  symbol: RideSymbol,
  size: number,
): void {
  switch (symbol.shape) {
    case 'star':
      softStar(ctx, 0, 0, size, size * 0.5)
      ctx.fill()
      break
    case 'heart':
      heart(ctx, 0, -size * 0.1, size * 0.75)
      ctx.fill()
      break
    case 'circle':
      circle(ctx, 0, 0, size * 0.85)
      ctx.fill()
      break
    case 'triangle':
      polygon(ctx, 0, size * 0.05, size, 3)
      ctx.fill()
      break
    case 'square':
      roundRectCentered(ctx, 0, 0, size * 1.5, size * 1.5, size * 0.3)
      ctx.fill()
      break
  }
}
