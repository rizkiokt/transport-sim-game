/**
 * The town: the whole game.
 *
 * Owns the 3D scene graph, the car, the ride loop, the HUD and all the
 * feedback that makes an event feel like something. Persistence flows through
 * here — every dropoff banks coins into the save.
 *
 * In dev builds it installs a small autopilot API on globalThis so the
 * headless playtest can drive the real physics through the same control path
 * a child's finger uses, and assert that coins actually arrive.
 */

import { Scene } from 'three'

import type { SaveStore } from '../../engine/core/storage.js'
import { ChaseCamera } from '../../engine/three/camera-rig.js'
import { Environment } from '../../engine/three/environment.js'
import { ParticleSystem3D } from '../../engine/three/particles3d.js'
import type { ThreeRenderer } from '../../engine/three/renderer.js'
import { RENDER_PROFILES } from '../../engine/three/renderer.js'
import type { InputManager } from '../../engine/input/input.js'
import type { AudioBus } from '../../engine/audio/audio-bus.js'
import type { SettingsManager } from '../../engine/core/settings.js'
import { angleDelta, clamp, wrapAngle } from '../../engine/math/scalar.js'
import { getVehicle } from '../../content/vehicles.js'
import {
  EngineSound,
  playBonk,
  playClick,
  playCoin,
  playDropoff,
  playHorn,
  playPickup,
} from '../audio/sfx.js'
import {
  ART_TO_WORLD,
  createCar,
  createCarMaterials,
  disposeCar,
  disposeCarMaterials,
  type CarParts,
  type CarSharedMaterials,
} from '../art/car-model.js'
import { Vehicle3D } from '../entities/vehicle3d.js'
import { type GameSave, sanitizeSave } from '../save.js'
import { RideSystem3D } from '../systems/ride-system3d.js'
import { Hud3D } from '../ui/hud3d.js'
import { Minimap } from '../ui/minimap.js'
import { Shop } from '../ui/shop.js'
import { computeEffects, getUpgrade, upgradeCost } from '../../content/upgrades.js'
import { exportSaveToFile, importSaveFromFile } from '../save.js'
import { generateCity3D, WORLD_SCALE, type City3D } from '../world/city3d.js'

const TOWN_SEED = 'sunnyville-1'

const CONFETTI_COLORS = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585]
const COIN_COLORS = [0xffc93c, 0xffe08a]
const DUST_COLORS = [0xc9bfa8, 0xb8ad94, 0xd8cfba]
const SPARKLE_COLORS = [0xffd166, 0xffe9a8, 0xffffff]
const UPGRADE_IDS = ['speed', 'boost', 'grip', 'fare'] as const

export interface TownDeps {
  renderer: ThreeRenderer
  input: InputManager
  audio: AudioBus
  settings: SettingsManager
  store: SaveStore<GameSave>
  save: GameSave
  hudContainer: HTMLElement
  surface: HTMLElement
}

export class TownScene3D {
  readonly scene = new Scene()

  readonly #deps: TownDeps
  readonly #save: GameSave

  readonly #city: City3D
  readonly #environment: Environment
  readonly #chase: ChaseCamera
  readonly #car: Vehicle3D
  readonly #carParts: CarParts
  readonly #carMaterials: CarSharedMaterials
  readonly #rides: RideSystem3D
  readonly #hud: Hud3D
  readonly #particles: ParticleSystem3D
  readonly #engineSound: EngineSound
  readonly #minimap: Minimap
  readonly #shop: Shop

  #time = 0
  #exhaustTimer = 0
  /** Remaining autopilot waypoints; the last one is the true destination. */
  #autoPath: Array<{ x: number; z: number }> = []
  /** Seconds the autopilot has been making no progress. */
  #autoStuckTime = 0

  constructor(deps: TownDeps) {
    this.#deps = deps
    this.#save = sanitizeSave(deps.save)

    // -- World -----------------------------------------------------------
    this.#city = generateCity3D(TOWN_SEED)
    this.scene.add(this.#city.root)

    const profile = RENDER_PROFILES[deps.renderer.tier]
    this.#environment = new Environment(this.scene, deps.renderer.renderer, {
      shadowMapSize: profile.shadowMapSize,
      fogNear: profile.drawDistance * 0.35,
      fogFar: profile.drawDistance * 0.95,
    })
    this.#environment.setEnvironmentEnabled(profile.environmentLighting)

    // -- Car -------------------------------------------------------------
    const def = getVehicle(this.#save.activeVehicle)
    this.#car = new Vehicle3D(this.#city, def, computeEffects(this.#save.upgrades))

    const roads = this.#city.roads
    const spawnX = Math.round(roads.cols / 2 - 1) * roads.blockSize * WORLD_SCALE
    const spawnZ = Math.round(roads.rows / 2 - 1) * roads.blockSize * WORLD_SCALE
    this.#car.place(spawnX, spawnZ, 0)

    this.#carMaterials = createCarMaterials()
    this.#carParts = createCar({ art: def.art, paint: 0xffc93c }, this.#carMaterials)
    this.scene.add(this.#carParts.root)

    // -- Camera -----------------------------------------------------------
    // Close and low: the car has to read large for a young player, and a low
    // angle puts the road and the buildings' faces in frame rather than a
    // map-like view of their roofs.
    this.#chase = new ChaseCamera(deps.renderer.camera, {
      distance: 6.2 + def.art.length * ART_TO_WORLD * 0.5,
      height: 2.7,
      distanceAtSpeed: 2.4,
      heightAtSpeed: 0.7,
      lookHeight: 1.15,
    })
    this.#chase.shakeScale = deps.settings.shakeScale
    this.#chase.snapTo(this.#car.x, 0.8, this.#car.z, this.#car.heading)

    // -- Effects ----------------------------------------------------------
    this.#particles = new ParticleSystem3D(700)
    this.#particles.intensity = deps.settings.particleScale
    this.scene.add(this.#particles.mesh)

    // -- Rides ------------------------------------------------------------
    this.#rides = new RideSystem3D(
      this.scene,
      this.#city,
      {
        onPickup: (x, y, z) => this.#handlePickup(x, y, z),
        onDropoff: (fare, x, y, z) => this.#handleDropoff(fare, x, y, z),
      },
      this.#save.totalRides,
    )

    // -- HUD --------------------------------------------------------------
    this.#hud = new Hud3D(
      deps.hudContainer,
      deps.surface,
      {
        onMuteToggle: () => this.#toggleMute(),
        onHorn: () => this.#honk(),
        onShop: () => this.#openShop(),
      },
      this.#save.coins,
    )
    this.#hud.setMuted(this.#save.muted)

    // The map mounts inside the HUD layer so it inherits its safe-area
    // padding and pointer-events rules.
    this.#minimap = new Minimap(this.#hud.layer, {
      bounds: this.#city.bounds,
      roads: this.#city.roads,
      worldScale: WORLD_SCALE,
    })

    this.#shop = new Shop(deps.hudContainer, {
      onBuy: (id) => this.#buyUpgrade(id),
      onExport: () => exportSaveToFile(this.#save),
      onImport: (file) => void this.#importSave(file),
      onClose: () => this.#closeShop(),
    })
    this.#refreshShop()

    this.#engineSound = new EngineSound(deps.audio)

    this.#installDevHooks()
  }

  update(dt: number): void {
    this.#time += dt
    const input = this.#deps.input

    // -- Controls: keyboard/gamepad and touch merge into one intent -------
    let throttle = Math.max(input.getValue('accelerate'), this.#hud.touchThrottle)
    let brake = Math.max(input.getValue('brake'), this.#hud.touchBrake)
    let steer = clamp(input.getAxis('steerLeft', 'steerRight') + this.#hud.touchSteer, -1, 1)

    // The dev autopilot drives through the same controls, so the playtest
    // exercises genuine physics rather than teleporting the car.
    if (this.#autoPath.length > 0) {
      const target = this.#autoPath[0]!
      const isFinal = this.#autoPath.length === 1
      const dist = Math.hypot(target.x - this.#car.x, target.z - this.#car.z)

      // Intermediate waypoints only need to be passed, not parked on.
      if (dist < (isFinal ? 1.5 : 3.5)) {
        this.#autoPath.shift()
        this.#autoStuckTime = 0
        throttle = 0
        brake = isFinal ? 1 : 0
      } else {
        const desired = Math.atan2(target.z - this.#car.z, target.x - this.#car.x)
        const delta = angleDelta(this.#car.heading, desired)
        steer = clamp(delta * 2.2, -1, 1)

        // Ease off for sharp corrections so it does not orbit the waypoint,
        // and slow on final approach so it arrives instead of overshooting.
        const approach = isFinal ? clamp(dist / 12, 0.25, 1) : 1
        throttle = (Math.abs(delta) > 1.2 ? 0.32 : 1) * approach
        brake = 0

        // Wedged against something: reverse straight back, then give up on
        // this route entirely and let the caller plan a fresh one from
        // wherever we ended up.
        //
        // The previous version reversed with the steering held over, which
        // could drive the car further into the block it was stuck in, and it
        // never stopped trying — so a wedged car stayed wedged forever
        // instead of reporting failure. Reversing straight is safer, and
        // abandoning the path is what a player does when a route turns out
        // not to work: reassess rather than keep shoving.
        if (Math.abs(this.#car.speed) < 0.4) {
          this.#autoStuckTime += dt
          if (this.#autoStuckTime > 0.5) {
            throttle = 0
            brake = 1
            steer = 0
          }
          if (this.#autoStuckTime > 2.5) {
            this.#autoPath.length = 0
            this.#autoStuckTime = 0
          }
        } else {
          this.#autoStuckTime = 0
        }
      }
    }

    this.#car.controls.throttle = throttle
    this.#car.controls.brake = brake
    this.#car.controls.steer = steer

    if (input.justPressed('horn')) this.#honk()
    if (input.justPressed('mute')) this.#toggleMute()

    // -- Simulation --------------------------------------------------------
    this.#car.update(dt)
    this.#rides.update(dt, this.#car)

    this.#syncCarTransform()
    this.#updateFeedback(dt, throttle, brake)

    // -- Camera, lights, audio ---------------------------------------------
    this.#chase.follow(this.#car.x, 0.8, this.#car.z, this.#car.heading, this.#car.speedFraction, dt)
    this.#environment.followTarget(this.#car.x, 0, this.#car.z)
    this.#particles.update(dt)
    this.#engineSound.update(this.#car.speedFraction)

    this.#hud.update(dt)
    this.#updateCompass()

    this.#minimap.update(
      this.#car,
      this.#rides.hasTarget
        ? { x: this.#rides.targetX, z: this.#rides.targetZ, color: this.#rides.color }
        : null,
    )
  }

  render(): void {
    this.#deps.renderer.render(this.scene)
  }

  dispose(): void {
    this.#engineSound.dispose()
    this.#deps.store.flush()
    this.#hud.dispose()
    this.#minimap.dispose()
    this.#shop.dispose()
    this.#rides.dispose()
    this.#particles.dispose()
    disposeCar(this.#carParts)
    disposeCarMaterials(this.#carMaterials)
    this.#environment.dispose()
    this.#city.dispose()
    this.#removeDevHooks()
  }

  // -------------------------------------------------------------- internals

  #syncCarTransform(): void {
    const car = this.#car
    const parts = this.#carParts

    parts.root.position.set(car.x, 0, car.z)
    // Heading 0 faces +X. A mesh built facing +X needs -heading about Y,
    // because Three's Y rotation goes counter-clockwise looking down.
    parts.root.rotation.y = -car.heading

    // Body pitch and roll ride on the inner group so the wheels stay planted.
    parts.body.rotation.z = car.visualPitch
    parts.body.rotation.x = car.visualRoll

    for (const wheel of parts.wheels) {
      wheel.rotation.z = -car.wheelSpin
    }
    for (const pivot of parts.steeredWheels) {
      pivot.rotation.y = -car.steerAngle
    }

    const braking = car.controls.brake > 0.1 || (car.controls.throttle === 0 && car.speed > 0.5)
    for (const light of parts.brakeLights) {
      const mat = light.material as { emissiveIntensity?: number }
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = braking ? 3 : 0.6
    }
  }

  #updateFeedback(dt: number, throttle: number, brake: number): void {
    const car = this.#car
    const impact = car.impact

    if (impact && impact.severity > 0) {
      playBonk(this.#deps.audio, impact.severity * 40)
      this.#chase.shake(Math.min(0.28, impact.severity * 0.12), 0.24)
      this.#particles.emit({
        x: impact.x,
        y: 0.5,
        z: impact.z,
        count: 8,
        speedMin: 1.5,
        speedMax: 4.5,
        spread: Math.PI * 0.7,
        lifeMin: 0.3,
        lifeMax: 0.7,
        sizeMin: 0.08,
        sizeMax: 0.16,
        sizeEnd: 0.2,
        gravity: -5,
        drag: 0.3,
        colors: DUST_COLORS,
        spinMin: -8,
        spinMax: 8,
      })
    }

    // Exhaust puffs while driving.
    if (throttle > 0.2 && Math.abs(car.speed) > 0.4) {
      this.#exhaustTimer -= dt
      if (this.#exhaustTimer <= 0) {
        this.#exhaustTimer = 0.14
        const back = -car.def.art.length * ART_TO_WORLD * 0.52
        // Small, slow, shrinking and barely spinning: a puff that dissipates.
        // Growing, tumbling exhaust reads as debris falling off the car.
        this.#particles.emit({
          x: car.x + Math.cos(car.heading) * back,
          y: 0.2,
          z: car.z + Math.sin(car.heading) * back,
          count: 1,
          vx: -Math.cos(car.heading) * 0.7,
          vz: -Math.sin(car.heading) * 0.7,
          speedMin: 0.1,
          speedMax: 0.35,
          spread: Math.PI * 0.35,
          lifeMin: 0.3,
          lifeMax: 0.55,
          sizeMin: 0.09,
          sizeMax: 0.15,
          sizeEnd: 0.05,
          gravity: 0.5,
          drag: 0.2,
          colors: [0xe4e4e4, 0xd0d0d0],
          spinMin: -1.2,
          spinMax: 1.2,
        })
      }
    }

    void brake
  }

  /**
   * Point the compass at the ride target, in screen space.
   *
   * The angle is computed relative to the camera's yaw rather than in world
   * space, so "up" on the compass always means "straight ahead" from the
   * player's point of view — which is the only reading a 6-year-old will make.
   */
  #updateCompass(): void {
    if (!this.#rides.hasTarget) {
      this.#hud.setCompass(0, false, false, this.#rides.color)
      return
    }

    const dx = this.#rides.targetX - this.#car.x
    const dz = this.#rides.targetZ - this.#car.z
    const distance = Math.hypot(dx, dz)

    const worldAngle = Math.atan2(dz, dx)
    // Screen angle: 0 = straight ahead (up on screen), positive = clockwise.
    const relative = wrapAngle(worldAngle - this.#chase.yaw)

    // Once the target is close and roughly ahead, the beacon does the job and
    // the compass gets out of the way.
    const onScreen = distance < 22 && Math.abs(relative) < 0.6

    this.#hud.setCompass(relative, true, onScreen, this.#rides.color)
  }

  #handlePickup(x: number, y: number, z: number): void {
    playPickup(this.#deps.audio)
    this.#particles.emit({
      x,
      y: y + 0.4,
      z,
      count: 12,
      speedMin: 1.2,
      speedMax: 3.6,
      spread: Math.PI * 0.5,
      lifeMin: 0.4,
      lifeMax: 0.8,
      sizeMin: 0.07,
      sizeMax: 0.14,
      sizeEnd: 0.2,
      gravity: -6,
      colors: SPARKLE_COLORS,
      spinMin: -10,
      spinMax: 10,
    })
  }

  #handleDropoff(baseFare: number, x: number, y: number, z: number): void {
    const fare = Math.round(baseFare * this.#car.effects.fare)
    this.#save.coins += fare
    this.#save.totalRides += 1
    this.#deps.store.save(this.#save)
    this.#hud.setCoins(this.#save.coins, true)

    playDropoff(this.#deps.audio)
    for (let i = 0; i < Math.min(6, Math.ceil(fare / 8)); i++) {
      playCoin(this.#deps.audio, i)
    }

    this.#chase.shake(0.08, 0.2)

    this.#particles.emit({
      x,
      y: y + 0.6,
      z,
      count: 34,
      speedMin: 2.5,
      speedMax: 7,
      spread: Math.PI * 0.55,
      lifeMin: 0.9,
      lifeMax: 1.8,
      sizeMin: 0.09,
      sizeMax: 0.19,
      sizeEnd: 0.7,
      gravity: -8.5,
      drag: 0.55,
      colors: CONFETTI_COLORS,
      spinMin: -14,
      spinMax: 14,
      spawnRadius: 0.4,
    })

    this.#particles.emit({
      x,
      y: y + 0.4,
      z,
      count: 10,
      speedMin: 2,
      speedMax: 4.5,
      spread: Math.PI * 0.4,
      lifeMin: 0.7,
      lifeMax: 1.2,
      sizeMin: 0.1,
      sizeMax: 0.16,
      sizeEnd: 0.4,
      gravity: -7,
      colors: COIN_COLORS,
      spinMin: -12,
      spinMax: 12,
    })
  }

  #honk(): void {
    playHorn(this.#deps.audio)
    this.#particles.emit({
      x: this.#car.x,
      y: 1.3,
      z: this.#car.z,
      count: 4,
      speedMin: 1,
      speedMax: 2.4,
      spread: 0.6,
      lifeMin: 0.6,
      lifeMax: 1,
      sizeMin: 0.1,
      sizeMax: 0.16,
      sizeEnd: 0.3,
      gravity: 1.4,
      drag: 0.5,
      colors: [0xffffff, 0xffd166, 0x4cc9f0],
      spinMin: -8,
      spinMax: 8,
    })
  }

  // -- Shop -----------------------------------------------------------------

  #openShop(): void {
    playClick(this.#deps.audio)
    this.#refreshShop()
    this.#shop.setOpen(true)
  }

  #closeShop(): void {
    playClick(this.#deps.audio)
    this.#shop.setOpen(false)
  }

  #refreshShop(): void {
    this.#shop.refresh(this.#save.coins, this.#save.upgrades)

    // Nudge the shop button only when something is actually buyable.
    const canAfford = UPGRADE_IDS.some((id) => {
      const def = getUpgrade(id)
      if (!def) return false
      const cost = upgradeCost(def, this.#save.upgrades[id] ?? 0)
      return cost !== null && this.#save.coins >= cost
    })
    this.#hud.setShopAffordable(canAfford)
  }

  #buyUpgrade(id: string): boolean {
    const def = getUpgrade(id)
    if (!def) return false

    const level = this.#save.upgrades[id] ?? 0
    const cost = upgradeCost(def, level)
    if (cost === null || this.#save.coins < cost) return false

    this.#save.coins -= cost
    this.#save.upgrades[id] = level + 1
    this.#deps.store.save(this.#save)

    // Recompute from base stats rather than scaling live values, so repeated
    // purchases cannot compound.
    this.#car.applyUpgrades(computeEffects(this.#save.upgrades))

    this.#hud.setCoins(this.#save.coins, false)
    this.#refreshShop()
    playDropoff(this.#deps.audio)
    return true
  }

  async #importSave(file: File): Promise<void> {
    const result = await importSaveFromFile(file)
    if (!result.ok) {
      this.#shop.setStatus(result.reason, 'error')
      return
    }

    Object.assign(this.#save, result.save)
    this.#deps.store.save(this.#save)
    this.#deps.store.flush()

    // Everything derived from the save has to be rebuilt, not just redrawn.
    this.#car.applyUpgrades(computeEffects(this.#save.upgrades))
    this.#hud.setCoins(this.#save.coins, true)
    this.#hud.setMuted(this.#save.muted)
    this.#deps.settings.set('muted', this.#save.muted)
    this.#rides.ridesCompleted = this.#save.totalRides
    this.#refreshShop()

    this.#shop.setStatus(result.migrated ? 'Loaded (from an older version).' : 'Loaded!')
  }

  #toggleMute(): void {
    const muted = this.#deps.settings.toggleMute()
    this.#save.muted = muted
    this.#deps.store.save(this.#save)
    this.#hud.setMuted(muted)
    playClick(this.#deps.audio)
  }

  // -- Dev hooks for the headless playtest ---------------------------------

  #installDevHooks(): void {
    if (!import.meta.env.DEV) return
    ;(globalThis as Record<string, unknown>)['__ts'] = {
      autopilot: (x: number, z: number): void => {
        this.#autoPath = this.#routeTo(x, z)
        this.#autoStuckTime = 0
      },
      /** Grant coins so the playtest can exercise buying without a long grind. */
      grantCoins: (amount: number): void => {
        this.#save.coins += amount
        this.#deps.store.save(this.#save)
        this.#hud.setCoins(this.#save.coins, false)
        this.#refreshShop()
      },
      buyUpgrade: (id: string): boolean => this.#buyUpgrade(id),
      /**
       * Lift the car back onto the nearest road.
       *
       * A test fixture, not a game mechanic. The autopilot is a naive
       * waypoint follower with no obstacle avoidance, so it can wedge itself
       * between buildings in a way a human player never would — they simply
       * reverse and steer out. Rather than build real navigation just to
       * satisfy the harness, the harness is allowed to admit defeat and put
       * the car back on tarmac. Dev builds only.
       */
      unstick: (): void => {
        const near = this.#city.roads.nearestRoad(
          this.#car.x / WORLD_SCALE,
          this.#car.z / WORLD_SCALE,
        )
        this.#car.place(near.x * WORLD_SCALE, near.y * WORLD_SCALE, near.tangent)
        this.#autoPath.length = 0
        this.#autoStuckTime = 0
      },
      upgrades: (): unknown => ({ ...this.#save.upgrades }),
      effects: (): unknown => ({ ...this.#car.effects }),
      maxSpeed: (): number => this.#car.maxSpeed,
      state: (): unknown => ({
        car: {
          x: this.#car.x,
          z: this.#car.z,
          speed: this.#car.speed,
          onRoad: this.#car.onRoad,
        },
        ride: {
          phase: this.#rides.phase,
          passengerX: this.#rides.passengerX,
          passengerZ: this.#rides.passengerZ,
          targetX: this.#rides.targetX,
          targetZ: this.#rides.targetZ,
          hasTarget: this.#rides.hasTarget,
        },
        coins: this.#save.coins,
        totalRides: this.#save.totalRides,
        autopilotActive: this.#autoPath.length > 0,
        waypointsLeft: this.#autoPath.length,
      }),
    }
  }

  /**
   * Build a route to a point that stays on roads.
   *
   * The town is a full grid, so no search is needed: drive to the nearest
   * junction, then Manhattan along one axis and then the other to the
   * junction nearest the destination, then finally off the road to the
   * destination itself.
   *
   * A naive straight-line seek drives into the middle of a building block and
   * wedges. This exists for the headless playtest, but it is also the
   * skeleton the ambient traffic AI will use.
   */
  #routeTo(x: number, z: number): Array<{ x: number; z: number }> {
    const roads = this.#city.roads
    const b = roads.blockSize * WORLD_SCALE
    const maxCol = roads.cols - 1
    const maxRow = roads.rows - 1

    const snap = (value: number, max: number): number =>
      clamp(Math.round(value / b), 0, max)

    const startCol = snap(this.#car.x, maxCol)
    const startRow = snap(this.#car.z, maxRow)
    const endCol = snap(x, maxCol)
    const endRow = snap(z, maxRow)

    const path: Array<{ x: number; z: number }> = []

    // Get onto tarmac first, via the CLOSEST POINT ON A ROAD rather than the
    // nearest junction. Pickups and dropoffs happen on the pavement, and a
    // straight line from there to a junction cuts diagonally through the
    // middle of a building block — which is exactly how the car ends up
    // wedged between two buildings with the throttle down.
    const near = roads.nearestRoad(this.#car.x / WORLD_SCALE, this.#car.z / WORLD_SCALE)
    path.push({ x: near.x * WORLD_SCALE, z: near.y * WORLD_SCALE })

    // Then onto the grid proper.
    path.push({ x: startCol * b, z: startRow * b })

    // Travel along X, junction by junction, then along Z. Stopping at every
    // junction rather than cutting corners keeps the car on tarmac, which is
    // where the road assist can help it.
    const colStep = endCol > startCol ? 1 : -1
    for (let c = startCol; c !== endCol; c += colStep) {
      path.push({ x: (c + colStep) * b, z: startRow * b })
    }
    const rowStep = endRow > startRow ? 1 : -1
    for (let r = startRow; r !== endRow; r += rowStep) {
      path.push({ x: endCol * b, z: (r + rowStep) * b })
    }

    // Finally leave the road for the destination itself.
    path.push({ x, z })
    return path
  }

  #removeDevHooks(): void {
    if (!import.meta.env.DEV) return
    delete (globalThis as Record<string, unknown>)['__ts']
  }
}
