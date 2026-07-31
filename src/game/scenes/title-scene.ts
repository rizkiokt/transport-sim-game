/**
 * The title screen: name, a bobbing taxi, and one giant pulsing play button.
 *
 * A non-reader's title screen has exactly one job — make the way in
 * unmissable. Anything tappable that isn't "play" is a trap, so there is
 * nothing else. The whole screen is the button; the visual ▶ just anchors
 * the eye. The starting tap doubles as the browser's audio unlock.
 */

import type { Game } from '../../engine/core/game.js'
import type { Scene, SceneContext } from '../../engine/core/scene.js'
import type { SaveStore } from '../../engine/core/storage.js'
import { outBack } from '../../engine/anim/easing.js'
import { toCss, withAlpha } from '../../engine/render/color.js'
import { fitTextSize, font } from '../../engine/render/fonts.js'
import { circle, polygon } from '../../engine/render/shapes.js'
import { playStart } from '../audio/sfx.js'
import { drawVehicle, drawVehicleShadow, NEUTRAL_POSE } from '../art/vehicle-art.js'
import { getVehicle } from '../../content/vehicles.js'
import { BRANDING } from '../config/branding.js'
import { PALETTE, VEHICLE_PAINTS } from '../config/palette.js'
import type { GameSave } from '../save.js'
import { TownScene } from './town-scene.js'

export class TitleScene implements Scene {
  readonly name = 'title'

  readonly #game: Game
  readonly #store: SaveStore<GameSave>
  readonly #save: GameSave

  #time = 0
  #started = false
  readonly #logo = { scale: 0, y: -40 }

  #sceneCtx: SceneContext | null = null

  constructor(game: Game, store: SaveStore<GameSave>, save: GameSave) {
    this.#game = game
    this.#store = store
    this.#save = save
  }

  enter(ctx: SceneContext): void {
    this.#sceneCtx = ctx
    this.#game.camera.snapTo(0, 0)
    this.#game.camera.setBaseZoom(1, true)

    this.#game.tweens.add({
      target: this.#logo,
      to: { scale: 1, y: 0 },
      duration: 0.7,
      delay: 0.1,
      ease: outBack,
    })
  }

  update(dt: number): void {
    this.#time += dt

    if (!this.#started && this.#game.input.anyInputJustPressed()) {
      this.#started = true
      playStart(this.#game.audio)
      // A brief beat so the start sound and button pop land before the cut.
      this.#game.tweens.delay(0.28, () => {
        this.#sceneCtx?.replace(new TownScene(this.#game, this.#store, this.#save))
      })
    }
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number, _frameDt: number): void {
    const view = this.#game.viewport
    const w = view.width
    const h = view.height

    // Grass field with a road across the lower third.
    ctx.fillStyle = toCss(PALETTE.grass)
    ctx.fillRect(0, 0, w, h)

    const roadY = h * 0.62
    ctx.fillStyle = toCss(PALETTE.sidewalk)
    ctx.fillRect(0, roadY - 52, w, 104)
    ctx.fillStyle = toCss(PALETTE.road)
    ctx.fillRect(0, roadY - 36, w, 72)

    ctx.strokeStyle = toCss(PALETTE.roadDash)
    ctx.lineWidth = 4
    ctx.setLineDash([18, 22])
    ctx.lineDashOffset = -this.#time * 60
    ctx.beginPath()
    ctx.moveTo(0, roadY)
    ctx.lineTo(w, roadY)
    ctx.stroke()
    ctx.setLineDash([])

    // The taxi, idling mid-frame with a gentle bob.
    const art = getVehicle(this.#save.activeVehicle).art
    ctx.save()
    ctx.translate(w * 0.5, roadY + Math.sin(this.#time * 3) * 1.5)
    ctx.scale(1.5, 1.5)
    drawVehicleShadow(ctx, art)
    drawVehicle(ctx, art, VEHICLE_PAINTS[0]!, NEUTRAL_POSE)
    ctx.restore()

    // Title.
    ctx.save()
    ctx.translate(w / 2, h * 0.2 + this.#logo.y)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const size = fitTextSize(ctx, BRANDING.title, w * 0.86, Math.round(view.minSide * 0.085), 700)
    ctx.font = font(size, 700)
    ctx.scale(this.#logo.scale, this.#logo.scale)
    ctx.lineWidth = Math.max(4, size * 0.14)
    ctx.strokeStyle = '#2c452c'
    ctx.strokeText(BRANDING.title, 0, 0)
    ctx.fillStyle = toCss(PALETTE.coinGold)
    ctx.fillText(BRANDING.title, 0, 0)
    ctx.restore()

    // The play button: big, pulsing, and anchored between title and taxi.
    const pulse = 1 + Math.sin(this.#time * 3.4) * 0.06
    const btnY = h * 0.42
    const btnR = Math.min(56, view.minSide * 0.09) * pulse * this.#logo.scale

    ctx.save()
    ctx.translate(w / 2, btnY)

    ctx.fillStyle = toCss(withAlpha(PALETTE.uiInk, 0.25))
    circle(ctx, 0, 4, btnR)
    ctx.fill()
    ctx.fillStyle = toCss(PALETTE.success)
    circle(ctx, 0, 0, btnR)
    ctx.fill()
    ctx.strokeStyle = toCss(PALETTE.uiInkLight)
    ctx.lineWidth = btnR * 0.09
    circle(ctx, 0, 0, btnR)
    ctx.stroke()

    ctx.fillStyle = toCss(PALETTE.uiInkLight)
    polygon(ctx, btnR * 0.08, 0, btnR * 0.5, 3, Math.PI / 2)
    ctx.fill()

    ctx.restore()
  }
}
