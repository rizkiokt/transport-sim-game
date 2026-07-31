/**
 * The town: where the whole game happens.
 *
 * Owns the generated city, the player's car, the ride loop, the HUD, and all
 * the feedback (particles, sounds, camera moves) that makes an event feel
 * like something. Persistence flows through here too: every dropoff banks
 * coins into the save.
 *
 * In dev builds the scene installs a tiny autopilot API on globalThis so the
 * headless playtest can drive the real physics to a passenger and assert
 * that coins actually arrive.
 */

import type { Game } from '../../engine/core/game.js'
import type { Scene, SceneContext } from '../../engine/core/scene.js'
import type { SaveStore } from '../../engine/core/storage.js'
import { ParticleShape } from '../../engine/fx/particles.js'
import { angleDelta, clamp } from '../../engine/math/scalar.js'
import { toCss } from '../../engine/render/color.js'
import { font } from '../../engine/render/fonts.js'
import { DebugOverlay } from '../../engine/debug/debug-overlay.js'
import { getVehicle } from '../../content/vehicles.js'
import { EngineSound, playBonk, playCoin, playClick, playDropoff, playHorn, playPickup } from '../audio/sfx.js'
import { drawVehicle, drawVehicleShadow, type VehiclePose } from '../art/vehicle-art.js'
import { PALETTE, VEHICLE_PAINTS } from '../config/palette.js'
import { PlayerVehicle } from '../entities/player-vehicle.js'
import { type GameSave, sanitizeSave } from '../save.js'
import { RideSystem } from '../systems/ride-system.js'
import { Hud } from '../ui/hud.js'
import { generateCity, type City } from '../world/city.js'
import { CityRenderer } from '../world/city-renderer.js'

/** The one town every player gets for now. A seed, not a random. */
const TOWN_SEED = 'sunnyville-1'

interface FarePopup {
  x: number
  y: number
  value: number
  age: number
}

const POPUP_LIFETIME = 1.3

export class TownScene implements Scene {
  readonly name = 'town'

  readonly #game: Game
  readonly #store: SaveStore<GameSave>
  readonly #save: GameSave

  #city!: City
  #cityRenderer!: CityRenderer
  #car!: PlayerVehicle
  #rides!: RideSystem
  #hud!: Hud
  #engineSound!: EngineSound
  #debug!: DebugOverlay

  #time = 0
  #exhaustTimer = 0
  readonly #popups: FarePopup[] = []

  /** Dev autopilot target, driven by the headless playtest. */
  #autoTarget: { x: number; y: number } | null = null

  constructor(game: Game, store: SaveStore<GameSave>, save: GameSave) {
    this.#game = game
    this.#store = store
    this.#save = sanitizeSave(save)
  }

  enter(_ctx: SceneContext): void {
    const game = this.#game

    this.#city = generateCity({ seed: TOWN_SEED })
    this.#cityRenderer = new CityRenderer(this.#city)

    this.#car = new PlayerVehicle(this.#city, getVehicle(this.#save.activeVehicle))
    // Spawn at a central intersection, facing along the road.
    const roads = this.#city.roads
    const spawnX = Math.round(roads.cols / 2 - 1) * roads.blockSize
    const spawnY = Math.round(roads.rows / 2 - 1) * roads.blockSize
    this.#car.place(spawnX, spawnY, 0)

    this.#rides = new RideSystem(
      this.#city,
      {
        onPickup: (x, y) => this.#handlePickup(x, y),
        onDropoff: (fare, x, y) => this.#handleDropoff(fare, x, y),
      },
      this.#save.totalRides,
    )

    this.#hud = new Hud(
      game,
      {
        onMuteToggle: () => this.#toggleMute(),
        onHorn: () => this.#honk(),
      },
      this.#save.coins,
    )

    this.#engineSound = new EngineSound(game.audio)
    this.#debug = new DebugOverlay(game)
    this.#debug.addLine(() => `car ${this.#car.x.toFixed(0)},${this.#car.y.toFixed(0)} spd ${this.#car.speed.toFixed(0)}`)
    this.#debug.addLine(() => `ride ${this.#rides.phase} coins ${this.#save.coins}`)

    const b = this.#city.bounds
    game.camera.setBounds(b.minX, b.minY, b.maxX, b.maxY)
    // Closer framing than the default: the car and passengers need to read
    // large and clear to young eyes, even at the cost of visible range.
    game.camera.setBaseZoom(1.28, true)
    game.camera.snapTo(this.#car.x, this.#car.y)

    game.settings.set('muted', this.#save.muted)

    this.#installDevHooks()
  }

  exit(): void {
    this.#engineSound.dispose()
    this.#store.flush()
    this.#game.camera.clearBounds()
    this.#removeDevHooks()
  }

  update(dt: number): void {
    this.#time += dt
    const game = this.#game
    const input = game.input

    this.#hud.update(dt)

    // -- Controls: keyboard/gamepad and touch merge into one intent -------
    const kbThrottle = input.getValue('accelerate')
    const kbBrake = input.getValue('brake')
    const kbSteer = input.getAxis('steerLeft', 'steerRight')

    let throttle = Math.max(kbThrottle, this.#hud.touchThrottle)
    let brake = Math.max(kbBrake, this.#hud.touchBrake)
    let steer = clamp(kbSteer + this.#hud.touchSteer, -1, 1)

    // Dev autopilot overrides intent through the same controls path, so the
    // playtest exercises genuine physics.
    if (this.#autoTarget) {
      const target = this.#autoTarget
      const dist = Math.hypot(target.x - this.#car.x, target.y - this.#car.y)
      if (dist < 34) {
        this.#autoTarget = null
        throttle = 0
        brake = 1
      } else {
        const desired = Math.atan2(target.y - this.#car.y, target.x - this.#car.x)
        const delta = angleDelta(this.#car.heading, desired)
        steer = clamp(delta * 2.2, -1, 1)
        // Ease off for sharp corrections so the autopilot doesn't orbit.
        throttle = Math.abs(delta) > 1.2 ? 0.35 : 1
        brake = 0
      }
    }

    this.#car.controls.throttle = throttle
    this.#car.controls.brake = brake
    this.#car.controls.steer = steer

    if (input.justPressed('horn')) this.#honk()
    if (input.justPressed('mute')) this.#toggleMute()
    if (import.meta.env.DEV && input.justPressed('debug')) this.#debug.toggle()

    // -- Simulation --------------------------------------------------------
    this.#car.update(dt)
    this.#rides.update(dt, this.#car)

    // -- Feedback ----------------------------------------------------------
    const impact = this.#car.impact
    if (impact && impact.severity > 40) {
      playBonk(game.audio, impact.severity)
      game.camera.shake(Math.min(6, impact.severity * 0.035), 0.25)
      game.particles.emit({
        x: impact.x,
        y: impact.y,
        count: 7,
        speedMin: 30,
        speedMax: 110,
        lifeMin: 0.3,
        lifeMax: 0.7,
        sizeMin: 3,
        sizeMax: 6,
        colors: DUST_COLORS,
        shape: ParticleShape.Puff,
        alphaStart: 0.8,
        alphaEnd: 0,
        sizeEnd: 2.2,
      })
    }

    this.#updateExhaust(dt, throttle)

    for (let i = this.#popups.length - 1; i >= 0; i--) {
      const p = this.#popups[i]!
      p.age += dt
      if (p.age >= POPUP_LIFETIME) this.#popups.splice(i, 1)
    }

    // -- Camera & audio ----------------------------------------------------
    game.camera.follow(this.#car, { x: this.#car.vx, y: this.#car.vy }, dt)
    this.#engineSound.update(Math.abs(this.#car.speed) / this.#car.maxSpeed)
  }

  render(ctx: CanvasRenderingContext2D, _alpha: number, frameDt: number): void {
    const game = this.#game

    ctx.fillStyle = toCss(PALETTE.grass)
    ctx.fillRect(0, 0, game.viewport.width, game.viewport.height)

    ctx.save()
    game.camera.applyTransform(ctx)

    this.#cityRenderer.renderGround(ctx, game.camera)
    this.#rides.render(ctx, this.#car.x, this.#car.y)
    this.#renderCar(ctx)
    game.particles.render(ctx, game.camera.getVisibleBounds(60))
    this.#cityRenderer.renderCanopy(ctx, game.camera, this.#time)
    this.#renderPopups(ctx)

    ctx.restore()

    // Screen space: HUD, then the debug overlay on top.
    const target = this.#rides.hasTarget
      ? { x: this.#rides.targetX, y: this.#rides.targetY, symbol: this.#rides.symbol }
      : null
    this.#hud.render(ctx, target)

    this.#debug.sample(frameDt)
    this.#debug.render(ctx)
  }

  // ------------------------------------------------------------- internals

  #renderCar(ctx: CanvasRenderingContext2D): void {
    const car = this.#car
    const pose: VehiclePose = {
      stretch: car.visualStretch,
      lean: car.visualLean,
      lights: 0.4,
      brakeLights: car.controls.brake > 0.1 ? 1 : 0,
    }

    ctx.save()
    ctx.translate(car.x, car.y)
    ctx.rotate(car.heading)
    drawVehicleShadow(ctx, car.def.art)
    drawVehicle(ctx, car.def.art, VEHICLE_PAINTS[0]!, pose)
    ctx.restore()
  }

  #renderPopups(ctx: CanvasRenderingContext2D): void {
    for (const p of this.#popups) {
      const t = p.age / POPUP_LIFETIME
      const rise = t * 44
      const alpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.6) / 0.4)
      const scale = t < 0.2 ? 0.6 + (t / 0.2) * 0.4 : 1

      ctx.save()
      ctx.translate(p.x, p.y - 30 - rise)
      ctx.scale(scale, scale)
      ctx.globalAlpha = clamp(alpha, 0, 1)

      ctx.font = font(24, 700)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 6
      ctx.lineJoin = 'round'
      ctx.strokeStyle = toCss(PALETTE.uiInk)
      ctx.strokeText(`+${p.value}`, 0, 0)
      ctx.fillStyle = toCss(PALETTE.coinGold)
      ctx.fillText(`+${p.value}`, 0, 0)

      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  #updateExhaust(dt: number, throttle: number): void {
    if (throttle < 0.2 || Math.abs(this.#car.speed) < 4) return
    this.#exhaustTimer -= dt
    if (this.#exhaustTimer > 0) return
    this.#exhaustTimer = 0.13

    const back = -this.#car.def.art.length / 2 - 4
    const cos = Math.cos(this.#car.heading)
    const sin = Math.sin(this.#car.heading)
    this.#game.particles.emit({
      x: this.#car.x + cos * back,
      y: this.#car.y + sin * back,
      count: 1,
      vx: -cos * 24,
      vy: -sin * 24,
      speedMin: 4,
      speedMax: 14,
      lifeMin: 0.5,
      lifeMax: 0.9,
      sizeMin: 3.5,
      sizeMax: 5.5,
      sizeEnd: 2.6,
      colors: EXHAUST_COLORS,
      shape: ParticleShape.Puff,
      alphaStart: 0.35,
      alphaEnd: 0,
    })
  }

  #handlePickup(x: number, y: number): void {
    const game = this.#game
    playPickup(game.audio)
    game.camera.punchZoom(0.05)
    game.particles.emit({
      x,
      y: y - 14,
      count: 10,
      speedMin: 40,
      speedMax: 130,
      lifeMin: 0.4,
      lifeMax: 0.8,
      sizeMin: 3,
      sizeMax: 6,
      gravity: 150,
      colors: SPARKLE_COLORS,
      shape: ParticleShape.Star,
      spinMin: -6,
      spinMax: 6,
      alphaEnd: 0,
    })
  }

  #handleDropoff(fare: number, x: number, y: number): void {
    const game = this.#game

    this.#save.coins += fare
    this.#save.totalRides += 1
    this.#store.save(this.#save)

    this.#hud.setCoins(this.#save.coins, true)
    this.#popups.push({ x, y, value: fare, age: 0 })

    playDropoff(game.audio)
    for (let i = 0; i < Math.min(6, Math.ceil(fare / 8)); i++) playCoin(game.audio, i)

    game.camera.punchZoom(0.09)
    game.particles.emit({
      x,
      y: y - 10,
      count: 26,
      speedMin: 70,
      speedMax: 220,
      lifeMin: 0.6,
      lifeMax: 1.2,
      sizeMin: 4,
      sizeMax: 8,
      gravity: 260,
      drag: 0.5,
      colors: CONFETTI_COLORS,
      shape: ParticleShape.Confetti,
      spinMin: -10,
      spinMax: 10,
      spawnRadius: 16,
      alphaEnd: 0.2,
    })
    game.particles.emit({
      x,
      y: y - 10,
      count: 9,
      speedMin: 50,
      speedMax: 150,
      lifeMin: 0.5,
      lifeMax: 0.9,
      sizeMin: 4,
      sizeMax: 7,
      gravity: -30,
      colors: COIN_COLORS,
      shape: ParticleShape.Circle,
      alphaEnd: 0,
    })
  }

  #honk(): void {
    playHorn(this.#game.audio)
    // Musical notes pop out of the car.
    this.#game.particles.emit({
      x: this.#car.x,
      y: this.#car.y - 20,
      count: 3,
      speedMin: 30,
      speedMax: 70,
      angle: -Math.PI / 2,
      spread: 0.7,
      lifeMin: 0.5,
      lifeMax: 0.9,
      sizeMin: 4,
      sizeMax: 6,
      gravity: -60,
      colors: NOTE_COLORS,
      shape: ParticleShape.Circle,
      alphaEnd: 0,
    })
  }

  #toggleMute(): void {
    const muted = this.#game.settings.toggleMute()
    this.#save.muted = muted
    this.#store.save(this.#save)
    playClick(this.#game.audio)
  }

  // -- Dev hooks for the headless playtest --------------------------------

  #installDevHooks(): void {
    if (!import.meta.env.DEV) return
    ;(globalThis as Record<string, unknown>)['__ts'] = {
      autopilot: (x: number, y: number): void => {
        this.#autoTarget = { x, y }
      },
      place: (x: number, y: number, heading = 0): void => {
        this.#car.place(x, y, heading)
        this.#game.camera.snapTo(x, y)
      },
      state: (): unknown => ({
        car: { x: this.#car.x, y: this.#car.y, speed: this.#car.speed, onRoad: this.#car.onRoad },
        ride: {
          phase: this.#rides.phase,
          passengerX: this.#rides.passengerX,
          passengerY: this.#rides.passengerY,
          targetX: this.#rides.targetX,
          targetY: this.#rides.targetY,
          hasTarget: this.#rides.hasTarget,
        },
        coins: this.#save.coins,
        totalRides: this.#save.totalRides,
        autopilotActive: this.#autoTarget !== null,
      }),
    }
  }

  #removeDevHooks(): void {
    if (!import.meta.env.DEV) return
    delete (globalThis as Record<string, unknown>)['__ts']
  }
}

const DUST_COLORS = ['#c9bfa8', '#b8ad94', '#d8cfba']
const EXHAUST_COLORS = ['#d8d8d8', '#c4c4c4', '#e6e6e6']
const SPARKLE_COLORS = ['#ffd166', '#ffe9a8', '#ffffff']
const CONFETTI_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585']
const COIN_COLORS = ['#ffc93c', '#ffe08a']
const NOTE_COLORS = ['#ffffff', '#ffd166', '#4cc9f0']
