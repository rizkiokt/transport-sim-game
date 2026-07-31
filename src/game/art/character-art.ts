/**
 * The passenger character generator.
 *
 * Characters are tiny (≈26 world units tall) so they are built from bold,
 * readable shapes: a round head, a capsule body, dot eyes. Variety comes
 * from a seeded parameter roll — skin tone, outfit colour, hair style and
 * colour, and an occasional accessory — so regular passengers become
 * recognisable individuals ("the green hat one again!").
 *
 * Drawn standing, centred on the feet at the origin, facing the camera.
 */

import { createRng } from '../../engine/math/rng.js'
import { darken, toCss, type Rgba } from '../../engine/render/color.js'
import { circle, roundRectCentered } from '../../engine/render/shapes.js'
import {
  CLOTHING_COLORS,
  HAIR_COLORS,
  PALETTE,
  SKIN_TONES,
} from '../config/palette.js'

export type HairStyle = 'bald' | 'bowl' | 'spiky' | 'buns' | 'cap'

export interface CharacterLook {
  skin: Rgba
  outfit: Rgba
  hair: Rgba
  hairStyle: HairStyle
  /** Overall size multiplier: little kids ~0.8, grown-ups ~1.1. */
  scale: number
}

/** Roll a deterministic look from any integer/string id. */
export function generateLook(seed: number | string): CharacterLook {
  const rng = createRng(`character:${seed}`)
  return {
    skin: rng.pick(SKIN_TONES),
    outfit: rng.pick(CLOTHING_COLORS),
    hair: rng.pick(HAIR_COLORS),
    hairStyle: rng.pick(['bald', 'bowl', 'spiky', 'buns', 'cap'] as const),
    scale: rng.range(0.82, 1.12),
  }
}

export interface CharacterPose {
  /** Vertical bounce offset, world units (negative = up). */
  bounce: number
  /** 0..1 how enthusiastically the character waves. */
  wave: number
  /** Wave animation phase, radians. */
  wavePhase: number
}

export const IDLE_POSE: CharacterPose = { bounce: 0, wave: 0, wavePhase: 0 }

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  look: CharacterLook,
  pose: CharacterPose = IDLE_POSE,
): void {
  const s = look.scale

  ctx.save()

  // Ground shadow stays put while the body bounces — that contrast is what
  // sells the hop.
  ctx.fillStyle = toCss(PALETTE.shadow)
  ctx.beginPath()
  ctx.ellipse(0, 0, 7.5 * s, 3.2 * s, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.translate(0, pose.bounce)

  const bodyH = 13 * s
  const bodyW = 11 * s
  const headR = 6.2 * s
  const headY = -bodyH - headR * 0.7

  // Waving arm, drawn behind the body.
  if (pose.wave > 0.02) {
    const swing = Math.sin(pose.wavePhase) * 0.9 * pose.wave
    ctx.save()
    ctx.translate(bodyW * 0.42, -bodyH * 0.82)
    ctx.rotate(-0.9 + swing)
    ctx.strokeStyle = toCss(look.outfit)
    ctx.lineWidth = 3.6 * s
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(7.5 * s, -4 * s)
    ctx.stroke()
    // Hand.
    ctx.fillStyle = toCss(look.skin)
    circle(ctx, 8.6 * s, -4.8 * s, 2.4 * s)
    ctx.fill()
    ctx.restore()
  }

  // Body.
  ctx.fillStyle = toCss(look.outfit)
  roundRectCentered(ctx, 0, -bodyH / 2, bodyW, bodyH, bodyW * 0.45)
  ctx.fill()

  // A darker hem grounds the outfit.
  ctx.fillStyle = toCss(darken(look.outfit, 0.2))
  roundRectCentered(ctx, 0, -1.6 * s, bodyW, 3.2 * s, 1.6 * s)
  ctx.fill()

  // Head.
  ctx.fillStyle = toCss(look.skin)
  circle(ctx, 0, headY, headR)
  ctx.fill()

  // Hair.
  ctx.fillStyle = toCss(look.hair)
  switch (look.hairStyle) {
    case 'bald':
      break
    case 'bowl': {
      ctx.beginPath()
      ctx.arc(0, headY - headR * 0.12, headR * 1.02, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'spiky': {
      ctx.beginPath()
      for (let i = -2; i <= 2; i++) {
        const x = i * headR * 0.42
        ctx.moveTo(x - headR * 0.2, headY - headR * 0.72)
        ctx.lineTo(x, headY - headR * 1.45)
        ctx.lineTo(x + headR * 0.2, headY - headR * 0.72)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'buns': {
      ctx.beginPath()
      ctx.arc(0, headY - headR * 0.12, headR * 1.02, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      circle(ctx, -headR * 0.95, headY - headR * 0.8, headR * 0.42)
      ctx.fill()
      circle(ctx, headR * 0.95, headY - headR * 0.8, headR * 0.42)
      ctx.fill()
      break
    }
    case 'cap': {
      ctx.beginPath()
      ctx.arc(0, headY - headR * 0.15, headR * 1.05, Math.PI, 0)
      ctx.closePath()
      ctx.fill()
      // Peak.
      roundRectCentered(ctx, headR * 0.75, headY - headR * 0.18, headR * 0.95, headR * 0.34, 2)
      ctx.fill()
      break
    }
  }

  // Face: two dot eyes and a small smile. High contrast, readable at 20px.
  ctx.fillStyle = toCss(PALETTE.uiInk)
  circle(ctx, -headR * 0.36, headY - headR * 0.05, 1.1 * s)
  ctx.fill()
  circle(ctx, headR * 0.36, headY - headR * 0.05, 1.1 * s)
  ctx.fill()

  ctx.strokeStyle = toCss(PALETTE.uiInk)
  ctx.lineWidth = 1.1 * s
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, headY + headR * 0.25, headR * 0.38, 0.25, Math.PI - 0.25)
  ctx.stroke()

  ctx.restore()
}
