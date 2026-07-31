/**
 * The in-game HUD: coin counter, mute button, horn button, the destination
 * guidance arrow, and the touch driving control.
 *
 * Text-free by design — the only glyphs are digits (a 6-year-old reads
 * numbers long before words). Buttons are big (≥56px), corner-anchored, and
 * respond on the frame they're touched.
 *
 * Touch driving: press and hold anywhere (not on a button) to go; drag
 * sideways to steer; drag down past a threshold to brake/reverse. A soft
 * joystick visual appears under the finger so the mapping is discoverable
 * by doing, which is the only way a non-reader discovers anything.
 */

import type { Game } from '../../engine/core/game.js'
import type { PointerState } from '../../engine/input/input.js'
import { clamp } from '../../engine/math/scalar.js'
import { SpringValue } from '../../engine/anim/tween.js'
import { toCss, withAlpha } from '../../engine/render/color.js'
import { font } from '../../engine/render/fonts.js'
import { circle, polygon, roundRectCentered, wedge } from '../../engine/render/shapes.js'
import { softStar } from '../../engine/render/shapes.js'
import { PALETTE } from '../config/palette.js'
import type { RideSymbol } from '../art/symbols.js'
import { drawSymbol } from '../art/symbols.js'

export interface HudCallbacks {
  onMuteToggle(): void
  onHorn(): void
}

interface Button {
  /** Centre, computed each frame from the viewport. */
  x: number
  y: number
  r: number
  /** Scale spring for press feedback. */
  scale: SpringValue
}

const BUTTON_RADIUS = 30
const EDGE_PADDING = 22

/** Drag distances (CSS px) for full steering / brake engagement. */
const STEER_FULL_DRAG = 80
const BRAKE_DRAG = 70

export class Hud {
  /** Driving values produced by the touch control, consumed by the scene. */
  touchThrottle = 0
  touchSteer = 0
  touchBrake = 0

  readonly #game: Game
  readonly #callbacks: HudCallbacks

  readonly #coinSpring = new SpringValue(0, 0.4)
  #coinPulse = new SpringValue(1, 0.18)
  #displayedCoins = 0

  readonly #muteButton: Button = { x: 0, y: 0, r: BUTTON_RADIUS, scale: new SpringValue(1, 0.15) }
  readonly #hornButton: Button = { x: 0, y: 0, r: 36, scale: new SpringValue(1, 0.15) }

  /** Pointer currently driving, if any. */
  #drivePointerId: number | null = null
  #driveStartX = 0
  #driveStartY = 0
  #driveX = 0
  #driveY = 0

  #time = 0

  constructor(game: Game, callbacks: HudCallbacks, initialCoins: number) {
    this.#game = game
    this.#callbacks = callbacks
    this.#coinSpring.snap(initialCoins)
    this.#displayedCoins = initialCoins
  }

  /** Tell the HUD the coin balance changed; the counter rolls to meet it. */
  setCoins(coins: number, celebrate: boolean): void {
    this.#coinSpring.target = coins
    if (celebrate) this.#coinPulse.impulse(-9)
  }

  update(dt: number): void {
    this.#time += dt
    const input = this.#game.input
    const view = this.#game.viewport

    // Anchor buttons each frame so rotation/resize just works.
    this.#muteButton.x = view.width - EDGE_PADDING - BUTTON_RADIUS
    this.#muteButton.y = EDGE_PADDING + BUTTON_RADIUS
    this.#hornButton.x = view.width - EDGE_PADDING - this.#hornButton.r
    this.#hornButton.y = view.height - EDGE_PADDING - this.#hornButton.r

    // -- Button handling --------------------------------------------------
    for (const pointer of input.pointers) {
      if (pointer.justPressed) {
        if (this.#hit(this.#muteButton, pointer)) {
          this.#muteButton.scale.impulse(-6)
          this.#callbacks.onMuteToggle()
          continue
        }
        if (this.#hit(this.#hornButton, pointer)) {
          this.#hornButton.scale.impulse(-6)
          this.#callbacks.onHorn()
          continue
        }
        // Not a button: this finger drives (first driver wins).
        if (this.#drivePointerId === null) {
          this.#drivePointerId = pointer.id
          this.#driveStartX = pointer.position.x
          this.#driveStartY = pointer.position.y
          this.#driveX = pointer.position.x
          this.#driveY = pointer.position.y
        }
      }
    }

    // -- Touch driving -----------------------------------------------------
    if (this.#drivePointerId !== null) {
      const pointer = input.getPointer(this.#drivePointerId)
      if (!pointer || !pointer.pressed) {
        this.#drivePointerId = null
        this.touchThrottle = 0
        this.touchSteer = 0
        this.touchBrake = 0
      } else {
        this.#driveX = pointer.position.x
        this.#driveY = pointer.position.y

        const dx = this.#driveX - this.#driveStartX
        const dy = this.#driveY - this.#driveStartY

        this.touchSteer = clamp(dx / STEER_FULL_DRAG, -1, 1)
        if (dy > BRAKE_DRAG) {
          this.touchBrake = clamp((dy - BRAKE_DRAG) / BRAKE_DRAG, 0, 1)
          this.touchThrottle = 0
        } else {
          this.touchBrake = 0
          this.touchThrottle = 1
        }
      }
    }

    // -- Springs -----------------------------------------------------------
    this.#coinSpring.update(dt)
    this.#coinPulse.update(dt)
    this.#muteButton.scale.update(dt)
    this.#hornButton.scale.update(dt)
    this.#displayedCoins = Math.round(this.#coinSpring.value)
  }

  /**
   * Draw the HUD in screen space. `target` is where the guidance arrow
   * points (world space), tagged with the ride symbol for colour.
   */
  render(
    ctx: CanvasRenderingContext2D,
    target: { x: number; y: number; symbol: RideSymbol } | null,
  ): void {
    const view = this.#game.viewport

    ctx.save()
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)

    if (target) this.#renderGuidanceArrow(ctx, target)
    this.#renderCoins(ctx)
    this.#renderMuteButton(ctx)
    this.#renderHornButton(ctx)
    this.#renderTouchStick(ctx)

    ctx.restore()
  }

  // -------------------------------------------------------------- pieces

  #renderCoins(ctx: CanvasRenderingContext2D): void {
    const scale = this.#coinPulse.value
    const x = EDGE_PADDING
    const y = EDGE_PADDING
    const h = 46

    const label = String(this.#displayedCoins)
    ctx.font = font(26, 700)
    const textW = ctx.measureText(label).width
    const w = h + textW + 26

    ctx.save()
    ctx.translate(x + w / 2, y + h / 2)
    ctx.scale(scale, scale)
    ctx.translate(-(x + w / 2), -(y + h / 2))

    // Pill.
    ctx.fillStyle = toCss(PALETTE.uiPanel)
    roundRectCentered(ctx, x + w / 2, y + h / 2, w, h, h / 2)
    ctx.fill()

    // Coin: gold disc with a star stamp.
    const coinR = 16
    const coinX = x + 8 + coinR
    const coinY = y + h / 2
    ctx.fillStyle = toCss(PALETTE.coinGoldDark)
    circle(ctx, coinX, coinY + 1.5, coinR)
    ctx.fill()
    ctx.fillStyle = toCss(PALETTE.coinGold)
    circle(ctx, coinX, coinY, coinR)
    ctx.fill()
    ctx.fillStyle = toCss(PALETTE.coinGoldDark)
    softStar(ctx, coinX, coinY, coinR * 0.62, coinR * 0.3)
    ctx.fill()

    // Count.
    ctx.fillStyle = toCss(PALETTE.uiInkLight)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, coinX + coinR + 9, y + h / 2 + 1)

    ctx.restore()
  }

  #renderMuteButton(ctx: CanvasRenderingContext2D): void {
    const b = this.#muteButton
    const muted = this.#game.settings.settings.muted

    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.scale(b.scale.value, b.scale.value)

    ctx.fillStyle = toCss(PALETTE.uiPanel)
    circle(ctx, 0, 0, b.r)
    ctx.fill()

    // Speaker glyph: box + cone.
    ctx.fillStyle = toCss(PALETTE.uiInkLight)
    roundRectCentered(ctx, -9, 0, 8, 12, 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-7, 0)
    ctx.lineTo(4, -10)
    ctx.lineTo(4, 10)
    ctx.closePath()
    ctx.fill()

    if (muted) {
      // A friendly slash, not an angry X.
      ctx.strokeStyle = toCss(PALETTE.attention)
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-14, 14)
      ctx.lineTo(14, -14)
      ctx.stroke()
    } else {
      // Two sound arcs.
      ctx.strokeStyle = toCss(PALETTE.uiInkLight)
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      for (const r of [8, 13]) {
        ctx.beginPath()
        ctx.arc(5, 0, r, -0.7, 0.7)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  #renderHornButton(ctx: CanvasRenderingContext2D): void {
    const b = this.#hornButton

    ctx.save()
    ctx.translate(b.x, b.y)
    ctx.scale(b.scale.value, b.scale.value)

    ctx.fillStyle = toCss(PALETTE.attention)
    circle(ctx, 0, 1.5, b.r)
    ctx.fill()
    ctx.fillStyle = toCss(withAlpha(PALETTE.uiInkLight, 0.95))
    circle(ctx, 0, 0, b.r - 4)
    ctx.fill()

    // Horn glyph: bulb + flared trumpet.
    ctx.fillStyle = toCss(PALETTE.attention)
    circle(ctx, -11, 4, 6.5)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-7, 0)
    ctx.quadraticCurveTo(4, -8, 15, -11)
    ctx.lineTo(15, 3)
    ctx.quadraticCurveTo(4, 4, -6, 7)
    ctx.closePath()
    ctx.fill()
    wedge(ctx, 15, -4, 7, -Math.PI / 2.6, Math.PI / 2.6)
    ctx.fill()

    ctx.restore()
  }

  #renderTouchStick(ctx: CanvasRenderingContext2D): void {
    if (this.#drivePointerId === null) return

    const dx = clamp(this.#driveX - this.#driveStartX, -STEER_FULL_DRAG, STEER_FULL_DRAG)
    const dy = clamp(this.#driveY - this.#driveStartY, -20, BRAKE_DRAG * 2)

    ctx.globalAlpha = 0.4
    ctx.strokeStyle = toCss(PALETTE.uiInkLight)
    ctx.lineWidth = 3
    circle(ctx, this.#driveStartX, this.#driveStartY, 44)
    ctx.stroke()

    ctx.globalAlpha = 0.6
    ctx.fillStyle = toCss(PALETTE.uiInkLight)
    circle(ctx, this.#driveStartX + dx * 0.55, this.#driveStartY + dy * 0.35, 20)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  #renderGuidanceArrow(
    ctx: CanvasRenderingContext2D,
    target: { x: number; y: number; symbol: RideSymbol },
  ): void {
    const view = this.#game.viewport
    const screen = this.#game.camera.worldToScreen(target, ARROW_SCRATCH)

    // If the target is comfortably on screen, its own marker is guidance
    // enough — an arrow would just be noise.
    const margin = 70
    if (
      screen.x > margin &&
      screen.x < view.width - margin &&
      screen.y > margin &&
      screen.y < view.height - margin
    ) {
      return
    }

    // Clamp the arrow inside the screen edges, pointing at the target.
    const cx = view.width / 2
    const cy = view.height / 2
    const angle = Math.atan2(screen.y - cy, screen.x - cx)

    const pad = 56
    const halfW = view.width / 2 - pad
    const halfH = view.height / 2 - pad
    const t = Math.min(
      Math.abs(halfW / Math.max(0.0001, Math.abs(Math.cos(angle)))),
      Math.abs(halfH / Math.max(0.0001, Math.abs(Math.sin(angle)))),
    )
    const ax = cx + Math.cos(angle) * t
    const ay = cy + Math.sin(angle) * t

    const bounce = Math.sin(this.#time * 5) * 4

    ctx.save()
    ctx.translate(ax + Math.cos(angle) * bounce, ay + Math.sin(angle) * bounce)

    // Badge disc carrying the ride symbol, with a chevron pointing on.
    ctx.rotate(angle)
    ctx.fillStyle = toCss(target.symbol.color)
    polygon(ctx, 30, 0, 14, 3, Math.PI / 2)
    ctx.fill()
    ctx.rotate(-angle)

    ctx.fillStyle = toCss(PALETTE.uiPanelLight)
    circle(ctx, 0, 0, 22)
    ctx.fill()
    ctx.strokeStyle = toCss(target.symbol.color)
    ctx.lineWidth = 3.5
    circle(ctx, 0, 0, 22)
    ctx.stroke()

    drawSymbol(ctx, target.symbol, 11)

    ctx.restore()
  }

  #hit(button: Button, pointer: PointerState): boolean {
    const dx = pointer.position.x - button.x
    const dy = pointer.position.y - button.y
    // A generous hit halo beyond the visual edge — small fingers miss.
    const r = button.r + 14
    return dx * dx + dy * dy <= r * r
  }
}

const ARROW_SCRATCH = { x: 0, y: 0 }
