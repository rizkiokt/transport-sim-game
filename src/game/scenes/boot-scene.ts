/**
 * Temporary boot scene.
 *
 * This is an engine smoke test, not the real title screen: it exercises the
 * viewport, camera, tweens, particles, input, and audio end to end so we can
 * confirm the stack runs at 60fps on a real device before any gameplay
 * exists. It is replaced by the town scene once world generation lands.
 */

import type { Game } from '../../engine/core/game.js'
import type { Scene, SceneContext } from '../../engine/core/scene.js'
import { BRANDING } from '../config/branding.js'
import { ParticleShape } from '../../engine/fx/particles.js'
import { outBack } from '../../engine/anim/easing.js'
import { fromHex, toCss } from '../../engine/render/color.js'
import { capsule, circle, roundRectCentered } from '../../engine/render/shapes.js'
import { TAU } from '../../engine/math/scalar.js'

const SKY = fromHex('#1b2a4a')
const GRASS = fromHex('#3d8b5f')
const ROAD = fromHex('#4a4e5a')
const TAXI_BODY = fromHex('#ffc93c')
const TAXI_DARK = fromHex('#e0a800')
const WINDOW = fromHex('#9fd8ef')
const TYRE = fromHex('#2b2b33')
const SHADOW = fromHex('#00000033')

const CONFETTI_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585']

export class BootScene implements Scene {
  readonly name = 'boot'

  readonly #game: Game

  /** Animated demo state. */
  #angle = 0
  #bob = 0
  readonly #logo = { scale: 0, y: -40 }

  constructor(game: Game) {
    this.#game = game
  }

  enter(_ctx: SceneContext): void {
    this.#game.camera.snapTo(0, 0)
    this.#game.camera.setZoom(1, true)

    // Spring the title in — the same overshoot curve the real UI will use.
    this.#game.tweens.add({
      target: this.#logo,
      to: { scale: 1, y: 0 },
      duration: 0.7,
      delay: 0.15,
      ease: outBack,
    })
  }

  update(dt: number): void {
    this.#angle += dt * 0.6
    this.#bob += dt

    const input = this.#game.input

    // Any tap or key produces a confetti burst, proving input -> particles ->
    // audio all connect.
    if (input.anyInputJustPressed()) {
      this.#celebrate()
    }

    // Drive the camera in a slow circle so follow/lookahead are exercised.
    const radius = 40
    const target = {
      x: Math.cos(this.#angle) * radius,
      y: Math.sin(this.#angle) * radius * 0.4,
    }
    const velocity = {
      x: -Math.sin(this.#angle) * radius * 0.6,
      y: Math.cos(this.#angle) * radius * 0.24,
    }
    this.#game.camera.follow(target, velocity, dt)
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number, _frameDt: number): void {
    const { viewport, camera, particles } = this.#game

    ctx.fillStyle = toCss(SKY)
    ctx.fillRect(0, 0, viewport.width, viewport.height)

    ctx.save()
    camera.applyTransform(ctx)

    this.#drawGround(ctx)
    this.#drawTaxi(ctx)

    particles.render(ctx, camera.getVisibleBounds(64))

    ctx.restore()

    this.#drawTitle(ctx)
  }

  #drawGround(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = toCss(GRASS)
    ctx.fillRect(-2000, -2000, 4000, 4000)

    // A road strip with dashed centre line.
    ctx.fillStyle = toCss(ROAD)
    ctx.fillRect(-2000, -60, 4000, 120)

    ctx.strokeStyle = '#f2f2f2'
    ctx.lineWidth = 5
    ctx.setLineDash([40, 34])
    ctx.beginPath()
    ctx.moveTo(-2000, 0)
    ctx.lineTo(2000, 0)
    ctx.stroke()
    ctx.setLineDash([])
  }

  #drawTaxi(ctx: CanvasRenderingContext2D): void {
    // A gentle idle bob, the same technique the real vehicles use.
    const bobOffset = Math.sin(this.#bob * 3) * 1.4
    const lean = Math.sin(this.#bob * 1.2) * 0.03

    ctx.save()
    ctx.translate(0, bobOffset)

    // Ground shadow first, offset slightly and unaffected by the lean.
    ctx.fillStyle = toCss(SHADOW)
    ctx.beginPath()
    ctx.ellipse(2, 6 - bobOffset * 0.4, 46, 20, 0, 0, TAU)
    ctx.fill()

    ctx.rotate(lean)

    // Wheels, drawn under the body.
    ctx.fillStyle = toCss(TYRE)
    for (const [wx, wy] of [
      [-24, -22],
      [24, -22],
      [-24, 22],
      [24, 22],
    ] as const) {
      roundRectCentered(ctx, wx, wy, 20, 11, 5)
      ctx.fill()
    }

    // Body: a soft capsule with a darker skirt for volume.
    ctx.fillStyle = toCss(TAXI_DARK)
    capsule(ctx, 0, 3, 92, 46)
    ctx.fill()

    ctx.fillStyle = toCss(TAXI_BODY)
    capsule(ctx, 0, 0, 92, 44)
    ctx.fill()

    // Cabin glass.
    ctx.fillStyle = toCss(WINDOW)
    roundRectCentered(ctx, -4, 0, 34, 30, 9)
    ctx.fill()

    // Headlights.
    ctx.fillStyle = '#fff6c9'
    circle(ctx, 40, -12, 5)
    ctx.fill()
    circle(ctx, 40, 12, 5)
    ctx.fill()

    // Taxi sign on the roof.
    ctx.fillStyle = '#ffffff'
    roundRectCentered(ctx, -2, 0, 16, 10, 3)
    ctx.fill()

    ctx.restore()
  }

  #drawTitle(ctx: CanvasRenderingContext2D): void {
    const { viewport } = this.#game
    const cx = viewport.width / 2
    const cy = viewport.height * 0.16 + this.#logo.y

    ctx.save()
    ctx.translate(cx, cy)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'

    // Size to the shorter screen dimension, then shrink further if the name
    // would still overflow. Without this, a long title clips off the edges of
    // a narrow portrait tablet.
    let fontSize = Math.round(viewport.minSide * 0.09)
    const maxWidth = viewport.width * 0.86

    ctx.font = `700 ${fontSize}px system-ui, sans-serif`
    const measured = ctx.measureText(BRANDING.title).width
    if (measured > maxWidth) {
      fontSize = Math.max(14, Math.floor(fontSize * (maxWidth / measured)))
      ctx.font = `700 ${fontSize}px system-ui, sans-serif`
    }

    // Scale after measuring so the spring-in animation never causes clipping.
    ctx.scale(this.#logo.scale, this.#logo.scale)

    ctx.lineWidth = Math.max(4, fontSize * 0.14)
    ctx.strokeStyle = '#12203c'
    ctx.strokeText(BRANDING.title, 0, 0)

    ctx.fillStyle = toCss(TAXI_BODY)
    ctx.fillText(BRANDING.title, 0, 0)

    ctx.restore()
  }

  #celebrate(): void {
    const { particles, camera, audio } = this.#game

    particles.emit({
      x: 0,
      y: 0,
      count: 40,
      speedMin: 90,
      speedMax: 240,
      lifeMin: 0.7,
      lifeMax: 1.4,
      sizeMin: 4,
      sizeMax: 9,
      gravity: 320,
      drag: 0.4,
      colors: CONFETTI_COLORS,
      shape: ParticleShape.Confetti,
      spinMin: -12,
      spinMax: 12,
      spawnRadius: 24,
      alphaEnd: 0,
    })

    camera.punchZoom(0.06)
    camera.shake(3, 0.22)

    // A short major-third blip, confirming the audio graph is alive.
    const voice = audio.allocateVoice('ui', 0.35, { key: 'boot-blip', minInterval: 0.08 })
    if (!voice) return

    const { ctx: actx, output, startTime } = voice
    const osc = actx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(660, startTime)
    osc.frequency.exponentialRampToValueAtTime(880, startTime + 0.12)

    output.gain.setValueAtTime(0, startTime)
    output.gain.linearRampToValueAtTime(0.35, startTime + 0.01)
    output.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.3)

    osc.connect(output)
    osc.start(startTime)
    osc.stop(startTime + 0.32)
    audio.registerSource(osc)
  }
}
