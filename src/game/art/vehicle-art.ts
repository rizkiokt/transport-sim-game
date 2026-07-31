/**
 * The parameterized top-down vehicle renderer.
 *
 * One draw pipeline serves every vehicle in the game: the taxi, the van, the
 * limo and the bus are all the same sequence of shapes with different
 * proportions from their {@link VehicleArt} data. That is what keeps adding
 * a vehicle a data change, not an art project.
 *
 * The car is drawn pointing along +x, centred on the origin. Callers
 * translate/rotate first. All the "juice" (squash from acceleration, lean
 * into turns) arrives via {@link VehiclePose} so the renderer stays pure.
 */

import { darken, lighten, toCss, type Rgba } from '../../engine/render/color.js'
import { capsule, circle, roundRectCentered } from '../../engine/render/shapes.js'
import { PALETTE } from '../config/palette.js'
import type { VehicleArt } from '../../content/vehicles.js'

export interface VehiclePose {
  /** Longitudinal squash: >1 stretches forward (accel), <1 squashes (brake). */
  stretch: number
  /** Body lean into a turn, radians. Small — cosmetic only. */
  lean: number
  /** 0..1 headlight intensity. */
  lights: number
  /** 0..1 brake light intensity. */
  brakeLights: number
}

export const NEUTRAL_POSE: VehiclePose = { stretch: 1, lean: 0, lights: 0, brakeLights: 0 }

/**
 * Draw the soft blob shadow. Separate from the body so the scene can draw
 * all shadows before all bodies if it ever batches.
 */
export function drawVehicleShadow(
  ctx: CanvasRenderingContext2D,
  art: VehicleArt,
): void {
  ctx.fillStyle = toCss(PALETTE.shadow)
  ctx.beginPath()
  ctx.ellipse(1, 3, art.length * 0.54, art.width * 0.62, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  art: VehicleArt,
  paint: Rgba,
  pose: VehiclePose = NEUTRAL_POSE,
): void {
  const L = art.length
  const W = art.width
  const halfL = L / 2
  const halfW = W / 2

  ctx.save()
  ctx.scale(pose.stretch, 1 / Math.sqrt(pose.stretch))
  ctx.rotate(pose.lean)

  // Wheels first, peeking out from under the body.
  ctx.fillStyle = toCss(PALETTE.tyre)
  const wheelX = halfL * 0.58
  const wheelY = halfW * 0.92
  const wheelLen = L * 0.2
  const wheelWid = W * 0.22
  for (const [wx, wy] of [
    [-wheelX, -wheelY],
    [wheelX, -wheelY],
    [-wheelX, wheelY],
    [wheelX, wheelY],
  ] as const) {
    roundRectCentered(ctx, wx, wy, wheelLen, wheelWid, wheelWid * 0.4)
    ctx.fill()
  }

  // Body: a darker skirt underneath gives the shell a hint of thickness.
  const round = Math.max(4, halfW * art.roundness)
  ctx.fillStyle = toCss(darken(paint, 0.25))
  if (art.roundness > 0.8) capsule(ctx, 0, 1.5, L, W)
  else roundRectCentered(ctx, 0, 1.5, L, W, round)
  ctx.fill()

  ctx.fillStyle = toCss(paint)
  if (art.roundness > 0.8) capsule(ctx, 0, 0, L, W * 0.96)
  else roundRectCentered(ctx, 0, 0, L, W * 0.96, round)
  ctx.fill()

  // Bonnet/boot highlight: a lighter band across the nose.
  ctx.fillStyle = toCss(lighten(paint, 0.18))
  roundRectCentered(ctx, halfL * 0.55, 0, L * 0.22, W * 0.8, 4)
  ctx.fill()

  // Cabin glass. The windscreen is a single band; side windows repeat along
  // the cabin, which is how a bus reads as a bus.
  const cabinLen = L * (0.34 + art.sideWindows * 0.08)
  const cabinX = -halfL * 0.08
  ctx.fillStyle = toCss(PALETTE.glassEdge)
  roundRectCentered(ctx, cabinX, 0, cabinLen, W * 0.74, 6)
  ctx.fill()
  ctx.fillStyle = toCss(PALETTE.glass)
  roundRectCentered(ctx, cabinX, 0, cabinLen - 4, W * 0.62, 5)
  ctx.fill()

  // Window dividers.
  if (art.sideWindows > 1) {
    ctx.strokeStyle = toCss(PALETTE.glassEdge)
    ctx.lineWidth = 2.5
    ctx.beginPath()
    for (let i = 1; i < art.sideWindows; i++) {
      const x = cabinX - cabinLen / 2 + (cabinLen * i) / art.sideWindows
      ctx.moveTo(x, -W * 0.31)
      ctx.lineTo(x, W * 0.31)
    }
    ctx.stroke()
  }

  if (art.hasStripe) {
    ctx.fillStyle = toCss(lighten(paint, 0.35))
    roundRectCentered(ctx, -halfL * 0.62, 0, L * 0.28, W * 0.14, 2)
    ctx.fill()
  }

  if (art.hasSign) {
    ctx.fillStyle = toCss(PALETTE.uiInkLight)
    roundRectCentered(ctx, cabinX, 0, 10, 7, 2)
    ctx.fill()
    ctx.fillStyle = toCss(PALETTE.coinGoldDark)
    roundRectCentered(ctx, cabinX, 0, 5, 3.5, 1)
    ctx.fill()
  }

  // Headlights.
  const lightAlpha = 0.5 + pose.lights * 0.5
  ctx.globalAlpha = lightAlpha
  ctx.fillStyle = toCss(PALETTE.headlight)
  circle(ctx, halfL - 3, -halfW * 0.55, W * 0.1)
  ctx.fill()
  circle(ctx, halfL - 3, halfW * 0.55, W * 0.1)
  ctx.fill()

  // Brake lights.
  ctx.globalAlpha = 0.35 + pose.brakeLights * 0.65
  ctx.fillStyle = toCss(PALETTE.taillight)
  circle(ctx, -halfL + 3, -halfW * 0.55, W * 0.09)
  ctx.fill()
  circle(ctx, -halfL + 3, halfW * 0.55, W * 0.09)
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.restore()
}

/**
 * Headlight cones projected on the ground, drawn before the vehicle body.
 * Only worth showing at dusk/night, so intensity is a parameter.
 */
export function drawHeadlightCones(
  ctx: CanvasRenderingContext2D,
  art: VehicleArt,
  intensity: number,
): void {
  if (intensity <= 0.01) return
  const halfL = art.length / 2
  const halfW = art.width / 2

  ctx.save()
  ctx.globalAlpha = 0.16 * intensity
  ctx.fillStyle = toCss(PALETTE.headlight)
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(halfL - 4, side * halfW * 0.55)
    ctx.lineTo(halfL + art.length * 1.4, side * halfW * 1.7)
    ctx.lineTo(halfL + art.length * 1.4, side * halfW * 0.1)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}
