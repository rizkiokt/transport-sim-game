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
import { TrafficSystem } from '../systems/traffic.js'
import { Crowd } from '../systems/crowd.js'
import { CompanySystem, hireCost, type Driver } from '../systems/company.js'
import { CompanyBoard } from '../ui/company.js'
import { Avatar } from '../entities/avatar.js'
import { Hud3D } from '../ui/hud3d.js'
import { Minimap } from '../ui/minimap.js'
import { Shop } from '../ui/shop.js'
import { Garage } from '../ui/garage.js'
import { computeEffects, getUpgrade, upgradeCost } from '../../content/upgrades.js'
import { exportSaveToFile, importSaveFromFile } from '../save.js'
import { BLOCK_SIZE, WORLD_RADIUS_FOR_TIER, WorldStreamer } from '../world/world-streamer.js'
import { Depot, DEPOT_BLOCK_X, DEPOT_BLOCK_Z } from '../world/depot.js'
import { SurfaceLibrary } from '../../engine/three/textures.js'
import { PostProcessing } from '../../engine/three/post.js'

const TOWN_SEED = 'sunnyville-1'

/** Centre of the depot block. The one fixed landmark in an endless city. */
const DEPOT_X = (DEPOT_BLOCK_X + 0.5) * BLOCK_SIZE
const DEPOT_Z = (DEPOT_BLOCK_Z + 0.5) * BLOCK_SIZE

const CONFETTI_COLORS = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585]
const COIN_COLORS = [0xffc93c, 0xffe08a]
const DUST_COLORS = [0xc9bfa8, 0xb8ad94, 0xd8cfba]
const SPARKLE_COLORS = [0xffd166, 0xffe9a8, 0xffffff]
const UPGRADE_IDS = ['speed', 'boost', 'grip', 'fare'] as const

/** How close to the parked car you have to be to get back in, world units. */
const REBOARD_RADIUS = 7

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

  readonly #world: WorldStreamer
  readonly #depot: Depot
  readonly #surfaces: SurfaceLibrary
  readonly #environment: Environment
  readonly #chase: ChaseCamera
  #car: Vehicle3D
  #carParts: CarParts
  readonly #carMaterials: CarSharedMaterials
  readonly #rides: RideSystem3D
  readonly #traffic: TrafficSystem
  readonly #crowd: Crowd
  readonly #hud: Hud3D
  readonly #particles: ParticleSystem3D
  readonly #engineSound: EngineSound
  readonly #minimap: Minimap
  readonly #shop: Shop
  readonly #garage: Garage
  readonly #company: CompanySystem
  readonly #companyBoard: CompanyBoard
  /**
   * The player on foot. Built lazily the first time they step out, because
   * most sessions never will and a character model is not free.
   */
  #avatar: Avatar | null = null
  #onFoot = false
  /** Latches the depot trigger so it fires on arrival, not every frame. */
  #wasInDepot = false
  #post: PostProcessing | null = null

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
    // Textures are generated once here and shared by every surface. The low
    // tier halves the resolution: texture upload and memory matter far more
    // than fine detail on a device that is already struggling.
    const profileTier = deps.renderer.tier
    this.#surfaces = new SurfaceLibrary(profileTier === 'low' ? 256 : 512)
    this.#world = new WorldStreamer({
      seed: TOWN_SEED,
      surfaces: this.#surfaces,
      // Tied to the tier's draw distance, so the world always reaches the
      // fog. The streamer only pays for a rebuild when the player crosses a
      // chunk boundary, so a larger radius costs memory, not frame time.
      radius: WORLD_RADIUS_FOR_TIER[profileTier],
      // The watchdog can move the tier either way at runtime, so the instance
      // pools must be big enough for the largest world any tier asks for.
      maxRadius: Math.max(...Object.values(WORLD_RADIUS_FOR_TIER)),
      reservedBlocks: new Set([`${DEPOT_BLOCK_X}:${DEPOT_BLOCK_Z}`]),
    })
    this.scene.add(this.#world.root)

    this.#depot = new Depot({ x: DEPOT_X, z: DEPOT_Z, blockSize: BLOCK_SIZE })
    this.scene.add(this.#depot.root)
    this.#world.addStaticObstacles(this.#depot.obstacles)

    const profile = RENDER_PROFILES[deps.renderer.tier]
    this.#environment = new Environment(this.scene, deps.renderer.renderer, {
      shadowMapSize: profile.shadowMapSize,
      fogNear: profile.drawDistance * 0.35,
      fogFar: profile.drawDistance * 0.95,
    })
    this.#environment.setEnvironmentEnabled(profile.environmentLighting)
    this.#buildPostChain()

    // -- Car -------------------------------------------------------------
    const def = getVehicle(this.#save.activeVehicle)
    this.#car = new Vehicle3D(this.#world, def, computeEffects(this.#save.upgrades))

    // Start where fast travel lands you: on the street outside the depot,
    // facing along it. The world has no centre any more, so "at the depot" is
    // what starting means — and reusing the arrival point rather than a hand
    // -picked offset is what keeps the chase camera out of the shed walls.
    this.#car.place(this.#depot.arrivalX, this.#depot.arrivalZ, this.#depot.arrivalHeading)
    this.#world.refresh(this.#car.x, this.#car.z)

    this.#carMaterials = createCarMaterials()
    this.#carParts = createCar({ art: def.art, paint: def.paint }, this.#carMaterials)
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
      this.#world,
      {
        onPickup: (x, y, z) => this.#handlePickup(x, y, z),
        onDropoff: (fare, x, y, z) => this.#handleDropoff(fare, x, y, z),
      },
      this.#save.totalRides,
    )

    // -- City life --------------------------------------------------------
    // Both are pooled and instanced, so their cost is a handful of draw calls
    // regardless of population. Density drops on weaker devices.
    const busy = profileTier === 'low' ? 0.5 : profileTier === 'medium' ? 0.75 : 1
    this.#traffic = new TrafficSystem({
      roads: this.#world.roads,
      count: Math.round(18 * busy),
      despawnRadius: profile.drawDistance * 0.8,
    })
    this.scene.add(this.#traffic.root)
    this.#traffic.reset(this.#car.x, this.#car.z)

    this.#crowd = new Crowd({
      roads: this.#world.roads,
      count: Math.round(30 * busy),
      despawnRadius: Math.min(90, profile.drawDistance * 0.6),
    })
    this.scene.add(this.#crowd.root)
    this.#crowd.reset(this.#car.x, this.#car.z)

    // -- HUD --------------------------------------------------------------
    this.#hud = new Hud3D(
      deps.hudContainer,
      deps.surface,
      {
        onMuteToggle: () => this.#toggleMute(),
        onHorn: () => this.#honk(),
        onShop: () => this.#openShop(),
        onGarage: () => this.openGarage(),
        onCompany: () => this.#openCompany(),
        onFastTravel: () => this.fastTravelToDepot(),
        onToggleFoot: () => this.toggleOnFoot(),
      },
      this.#save.coins,
    )
    this.#hud.setMuted(this.#save.muted)

    // The map mounts inside the HUD layer so it inherits its safe-area
    // padding and pointer-events rules.
    this.#minimap = new Minimap(this.#hud.layer, {
      blockSize: this.#world.roads.blockSize,
      roadWidth: this.#world.roads.roadWidth,
    })

    this.#shop = new Shop(deps.hudContainer, {
      onBuy: (id) => this.#buyUpgrade(id),
      onExport: () => exportSaveToFile(this.#save),
      onImport: (file) => void this.#importSave(file),
      onClose: () => this.#closeShop(),
    })
    this.#garage = new Garage(deps.hudContainer, {
      onBuy: (id) => this.buyVehicle(id),
      onSelect: (id) => {
        this.setVehicle(id)
        this.#refreshGarage()
        playClick(this.#deps.audio)
      },
      onClose: () => {
        this.#garage.setOpen(false)
        playClick(this.#deps.audio)
      },
    })
    // -- Company -----------------------------------------------------------
    this.#company = new CompanySystem(
      { onEarn: (driver, coins) => this.#handleDriverEarnings(driver, coins) },
      this.#save.drivers,
    )
    this.#companyBoard = new CompanyBoard(deps.hudContainer, {
      onHire: (id) => this.#hireDriver(id),
      onClose: () => {
        this.#companyBoard.setOpen(false)
        playClick(this.#deps.audio)
      },
    })

    this.#depot.setFleet(this.#save.ownedVehicles, this.#save.activeVehicle)

    this.#refreshShop()
    this.#refreshGarage()
    this.#refreshCompany()

    this.#engineSound = new EngineSound(deps.audio)

    this.#installDevHooks()
  }

  /**
   * Re-apply everything derived from settings and the quality tier.
   *
   * These were previously read ONCE in the constructor, so the adaptive
   * quality watchdog only half-worked: it changed pixel ratio and draw
   * distance on the renderer, but shadows, image-based lighting, fog range,
   * particle density and camera shake all stayed frozen at whatever the tier
   * was when the town was built. A downgrade left the costs it was meant to
   * remove, and moved the far plane in without moving the fog, producing a
   * hard geometry cut-off in clear air.
   */
  applySettings(): void {
    const settings = this.#deps.settings
    const profile = RENDER_PROFILES[this.#deps.renderer.tier]

    // The streamed world belongs to the tier too. This is the difference
    // between a downgrade actually helping and a downgrade only moving the
    // fog in while the same geometry keeps being built behind it.
    this.#world.setRadius(WORLD_RADIUS_FOR_TIER[this.#deps.renderer.tier])
    const focus = this.#onFoot && this.#avatar ? this.#avatar : this.#car
    this.#world.update(focus.x, focus.z)

    this.#environment.setShadowMapSize(profile.shadowMapSize)
    this.#environment.setEnvironmentEnabled(profile.environmentLighting)
    this.#buildPostChain()
    this.#environment.setFogRange(profile.drawDistance * 0.35, profile.drawDistance * 0.95)

    this.#particles.intensity = settings.particleScale
    this.#chase.shakeScale = settings.shakeScale

    // The post chain belongs to the tier too; without this a downgrade would
    // keep paying for SSAO it was meant to drop.
    this.#buildPostChain()
  }

  /** Keep the post chain's render targets matched to the canvas. */
  resize(width: number, height: number): void {
    this.#post?.setSize(width, height)
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

    // The same three numbers drive either the car or the walker. Which one
    // they reach is the ONLY difference between the two modes — a child who
    // can drive can already walk.
    const controlled = this.#onFoot && this.#avatar ? this.#avatar.controls : this.#car.controls
    controlled.throttle = throttle
    controlled.brake = brake
    controlled.steer = steer

    if (this.#onFoot) {
      // Whatever the player is not currently holding must not keep its last
      // instruction, or the car drives off on its own the moment they step
      // out mid-throttle.
      this.#car.controls.throttle = 0
      this.#car.controls.brake = 0
      this.#car.controls.steer = 0
    }

    if (input.justPressed('horn')) this.#honk()
    if (input.justPressed('mute')) this.#toggleMute()

    // -- Simulation --------------------------------------------------------
    // Everything that streams or spawns follows the PLAYER, not the car —
    // otherwise walking away from a parked car would take you out of the
    // loaded world and leave you standing on blank ground.
    const focus = this.#onFoot && this.#avatar ? this.#avatar : this.#car
    this.#world.update(focus.x, focus.z)

    this.#car.update(dt)
    if (this.#onFoot) this.#avatar?.update(dt)

    this.#rides.update(dt, this.#car)
    this.#traffic.update(dt, focus.x, focus.z)
    this.#crowd.update(dt, focus.x, focus.z)
    // Drivers earn while you play; the car you are in is the one that does not.
    this.#company.update(dt, this.#car.def.id)

    this.#syncCarTransform()
    this.#updateFeedback(dt, throttle, brake)

    // Walking into your own depot opens it. Doing this by arriving rather
    // than by pressing a button is the point of the building existing.
    this.#updateDepotProximity()

    // -- Camera, lights, audio ---------------------------------------------
    const speedFraction = this.#onFoot ? 0 : this.#car.speedFraction
    const heading = this.#onFoot && this.#avatar ? this.#avatar.heading : this.#car.heading
    this.#chase.follow(focus.x, 0.8, focus.z, heading, speedFraction, dt)
    this.#environment.followTarget(focus.x, 0, focus.z)
    this.#particles.update(dt)
    this.#engineSound.update(speedFraction)

    this.#hud.update(dt)
    this.#updateCompass()

    if (this.#companyBoard.isOpen) this.#refreshCompany()

    this.#minimap.update(this.#onFoot && this.#avatar ? this.#avatar : this.#car, [
      { x: DEPOT_X, z: DEPOT_Z, color: 0x4cc9f0, square: true },
      // Where you left the car. Only while on foot — otherwise it would sit
      // permanently under the player's own arrow.
      this.#onFoot ? { x: this.#car.x, z: this.#car.z, color: 0xffc93c } : null,
      this.#rides.hasTarget
        ? { x: this.#rides.targetX, z: this.#rides.targetZ, color: this.#rides.color }
        : null,
    ])
  }

  render(): void {
    // When post-processing is off there is no composer in the path at all —
    // the scene renders straight to the canvas exactly as before.
    if (this.#post) this.#post.render()
    else this.#deps.renderer.render(this.scene)
  }

  /**
   * Build (or tear down) the post chain for the current quality tier.
   *
   * Recreated rather than reconfigured on a tier change, because the passes
   * allocate render targets sized to the effect and there is no meaningful
   * saving in keeping them around.
   */
  #buildPostChain(): void {
    this.#post?.dispose()
    this.#post = null

    const profile = RENDER_PROFILES[this.#deps.renderer.tier]
    if (!profile.postProcessing) return

    this.#post = new PostProcessing(
      this.#deps.renderer.renderer,
      this.scene,
      this.#deps.renderer.camera,
      {
        ssao: profile.ssao,
        bloom: true,
        // MSAA is only on at high tier, so post-AA earns its keep below that.
        fxaa: !profile.antialias,
        aoRadius: 0.5,
      },
    )
    this.#post.setSize(this.#deps.renderer.width, this.#deps.renderer.height)
  }

  dispose(): void {
    this.#post?.dispose()
    this.#post = null
    this.#engineSound.dispose()
    this.#deps.store.flush()
    this.#hud.dispose()
    this.#minimap.dispose()
    this.#shop.dispose()
    this.#garage.dispose()
    this.#companyBoard.dispose()
    this.#avatar?.dispose()
    this.#traffic.dispose()
    this.#crowd.dispose()
    this.#rides.dispose()
    this.#particles.dispose()
    disposeCar(this.#carParts)
    disposeCarMaterials(this.#carMaterials)
    this.#environment.dispose()
    this.#depot.dispose()
    this.#world.dispose()
    this.#surfaces.dispose()
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
    // Both multipliers apply. The vehicle's was declared on every vehicle and
    // never read, which made every car pay the same fare — so buying a bigger
    // one was a pure downgrade: slower, and no better paid. Exactly the kind
    // of trap the design forbids, since a child cannot tell it happened.
    const fare = Math.round(baseFare * this.#car.effects.fare * this.#car.def.fareMultiplier)
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

  // -- Fleet ------------------------------------------------------------------

  /**
   * Swap the active vehicle, rebuilding its model in place.
   *
   * The car keeps its position, heading and speed, so changing vehicle in the
   * garage does not teleport the player or interrupt a ride. Physics is
   * rebuilt from the new definition because handling, size and collision
   * radius all differ — a monster truck cannot inherit a taxi's footprint.
   */
  setVehicle(id: string): void {
    const def = getVehicle(id)
    if (def.id === this.#car.def.id) return

    const { x, z, heading, speed } = this.#car

    // Old model first: WebGL buffers are not garbage collected with the JS
    // object, so swapping without disposing leaks a car per change.
    this.scene.remove(this.#carParts.root)
    disposeCar(this.#carParts)

    this.#car = new Vehicle3D(this.#world, def, computeEffects(this.#save.upgrades))
    this.#car.place(x, z, heading)
    this.#car.speed = speed

    this.#carParts = createCar({ art: def.art, paint: def.paint }, this.#carMaterials)
    this.scene.add(this.#carParts.root)

    // Bigger vehicles need the camera further back or they fill the screen —
    // unless the player is out of the car, where the walker's framing wins.
    this.#applyCameraFraming()

    // Place the new model immediately rather than waiting for the next
    // update. Without this the car sits at the world origin until the next
    // frame — a visible pop in normal play, and nothing at all if the swap
    // happens while the loop is paused.
    this.#syncCarTransform()

    this.#save.activeVehicle = def.id
    this.#deps.store.save(this.#save)

    // The car you just took out is no longer parked in the depot, and its
    // driver (if it has one) has just gone idle.
    this.#depot.setFleet(this.#save.ownedVehicles, def.id)
    this.#refreshCompany()
  }

  /** Buy a vehicle. Returns true when the purchase went through. */
  buyVehicle(id: string): boolean {
    const def = getVehicle(id)
    if (this.#save.ownedVehicles.includes(def.id)) return false
    if (this.#save.coins < def.price) return false

    this.#save.coins -= def.price
    this.#save.ownedVehicles.push(def.id)
    this.#deps.store.save(this.#save)

    this.#hud.setCoins(this.#save.coins, true)
    this.setVehicle(def.id)

    // A newly bought car is parked in the depot until it is driven, and it
    // becomes staffable on the company board the moment it is owned.
    this.#depot.setFleet(this.#save.ownedVehicles, this.#save.activeVehicle)

    this.#refreshShop()
    this.#refreshGarage()
    this.#refreshCompany()
    playDropoff(this.#deps.audio)
    return true
  }

  // -- On foot ----------------------------------------------------------------

  /** True while the player is out of the car. */
  get isOnFoot(): boolean {
    return this.#onFoot
  }

  /**
   * Get out of the car, or get back in.
   *
   * Getting out parks the car where it stands and puts a walker beside the
   * driver's door. Getting back in is only offered near the car, and snaps
   * the player back into it.
   *
   * Refusing to step out while moving is deliberate: leaping from a moving
   * vehicle is exactly the kind of thing a six-year-old will try, and the
   * result — a car continuing away driverless — has no good outcome.
   */
  toggleOnFoot(): void {
    if (!this.#onFoot) {
      if (Math.abs(this.#car.speed) > 0.6) {
        // Not a refusal the child has to understand: just brake for them.
        this.#car.controls.throttle = 0
        this.#car.controls.brake = 1
        return
      }

      const avatar = this.#ensureAvatar()
      // Beside the car, but facing the way the CAR was facing rather than
      // away from it. The chase camera sits behind whatever it follows, so a
      // walker facing away from the car puts the camera directly on top of
      // the roof — you step out and the screen fills with paintwork.
      const side = this.#car.heading + Math.PI / 2
      const reach = this.#car.def.art.width * ART_TO_WORLD * 0.5 + 1.1
      avatar.place(
        this.#car.x + Math.cos(side) * reach,
        this.#car.z + Math.sin(side) * reach,
        this.#car.heading,
      )
      avatar.parts.root.visible = true

      this.#onFoot = true
      this.#car.controls.throttle = 0
      this.#car.controls.brake = 0
      this.#car.controls.steer = 0
      this.#car.speed = 0
    } else {
      const avatar = this.#avatar
      if (!avatar) return
      // Near the car, but generously so. Requiring arm's length made the
      // button silently do nothing from a couple of paces away, which for a
      // child reads as the game being broken rather than as a rule. The
      // parked car is marked on the map while on foot, so "walk back to it"
      // is always a followable instruction.
      if (Math.hypot(avatar.x - this.#car.x, avatar.z - this.#car.z) > REBOARD_RADIUS) return

      avatar.parts.root.visible = false
      this.#onFoot = false
    }

    this.#hud.setOnFoot(this.#onFoot)
    this.#applyCameraFraming()
    playClick(this.#deps.audio)
  }

  /**
   * Open the garage when the player reaches the depot.
   *
   * Fires once per arrival, not once per frame, and only when they are
   * actually stopped — driving through the forecourt at speed should not
   * throw a dialog in a child's face.
   */
  #updateDepotProximity(): void {
    const focus = this.#onFoot && this.#avatar ? this.#avatar : this.#car
    const inside = this.#depot.contains(focus.x, focus.z)
    const settled = this.#onFoot || Math.abs(this.#car.speed) < 1.2

    if (inside && settled && !this.#wasInDepot) {
      this.#wasInDepot = true
      if (!this.#garage.isOpen) this.openGarage()
    } else if (!inside) {
      this.#wasInDepot = false
    }
  }

  /**
   * Frame the camera for whatever is being followed.
   *
   * A person is roughly a third of a car's length and half its height, so
   * both the follow distance and the ride height have to come in — otherwise
   * walking looks like driving an invisible car with a doll on the bonnet.
   */
  #applyCameraFraming(): void {
    if (this.#onFoot) {
      this.#chase.setDistance(4.2)
      this.#chase.setHeights(2.1, 1.0)
    } else {
      this.#chase.setDistance(6.2 + this.#car.def.art.length * ART_TO_WORLD * 0.5)
      this.#chase.setHeights(2.7, 1.15)
    }
  }

  #ensureAvatar(): Avatar {
    if (!this.#avatar) {
      this.#avatar = new Avatar(this.#world, `${TOWN_SEED}:player`)
      this.scene.add(this.#avatar.parts.root)
    }
    return this.#avatar
  }

  // -- Depot --------------------------------------------------------------

  /**
   * Jump back to the depot.
   *
   * The one concession an endless city has to make. Without it, driving twenty
   * blocks in one direction is a one-way trip for a child who cannot yet read
   * a map, and "I'm lost" is the fastest way to lose a six-year-old's
   * interest. The map marker points home and this button goes there.
   */
  fastTravelToDepot(): void {
    const depot = this.#depot
    this.#car.place(depot.arrivalX, depot.arrivalZ, depot.arrivalHeading)

    if (this.#onFoot) {
      // Bring the walker along, not the empty car.
      const avatar = this.#ensureAvatar()
      const side = depot.arrivalHeading + Math.PI / 2
      avatar.place(
        depot.arrivalX + Math.cos(side) * 1.6,
        depot.arrivalZ + Math.sin(side) * 1.6,
        depot.arrivalHeading,
      )
    }

    // Build the world at the destination before the camera looks at it, or
    // the first frame after the jump is empty ground.
    this.#world.refresh(this.#car.x, this.#car.z)
    this.#traffic.reset(this.#car.x, this.#car.z)
    this.#crowd.reset(this.#car.x, this.#car.z)

    this.#syncCarTransform()
    const focusX = this.#onFoot ? this.#avatar!.x : this.#car.x
    const focusZ = this.#onFoot ? this.#avatar!.z : this.#car.z
    this.#chase.snapTo(focusX, 0.8, focusZ, depot.arrivalHeading)
    this.#environment.followTarget(focusX, 0, focusZ)

    playDropoff(this.#deps.audio)
  }

  // -- Company ------------------------------------------------------------

  #openCompany(): void {
    playClick(this.#deps.audio)
    this.#refreshCompany()
    this.#companyBoard.setOpen(true)
  }

  #refreshCompany(): void {
    this.#companyBoard.refresh({
      coins: this.#save.coins,
      owned: this.#save.ownedVehicles,
      active: this.#car.def.id,
      drivers: this.#company.drivers,
    })
  }

  /** Hire a driver for a vehicle. Returns true when it went through. */
  #hireDriver(vehicleId: string): boolean {
    if (!this.#save.ownedVehicles.includes(vehicleId)) return false
    if (this.#company.hasDriver(vehicleId)) return false

    const cost = hireCost(getVehicle(vehicleId))
    if (this.#save.coins < cost) return false

    this.#save.coins -= cost
    this.#company.hire(vehicleId)
    this.#save.drivers = this.#company.toJSON()
    this.#deps.store.save(this.#save)

    this.#hud.setCoins(this.#save.coins, false)
    this.#refreshCompany()
    this.#refreshShop()
    playDropoff(this.#deps.audio)
    return true
  }

  /**
   * A driver finished a trip.
   *
   * Paid with the same sound and coin burst as a fare the child drove
   * themselves, so where the money came from is never a mystery — and the
   * burst appears over the depot, which is where their driver just got back
   * to.
   */
  #handleDriverEarnings(_driver: Driver, coins: number): void {
    this.#save.coins += coins
    this.#save.drivers = this.#company.toJSON()
    this.#deps.store.save(this.#save)
    this.#hud.setCoins(this.#save.coins, false)

    playCoin(this.#deps.audio)
    this.#particles.emit({
      x: DEPOT_X,
      y: 3.2,
      z: DEPOT_Z,
      count: 6,
      speedMin: 1.2,
      speedMax: 3,
      lifeMin: 0.7,
      lifeMax: 1.1,
      sizeMin: 0.12,
      sizeMax: 0.2,
      colors: COIN_COLORS,
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

  /** Open the garage from anywhere (HUD button or title screen). */
  openGarage(): void {
    this.#refreshGarage()
    this.#garage.setOpen(true)
    playClick(this.#deps.audio)
  }

  #refreshGarage(): void {
    this.#garage.refresh({
      coins: this.#save.coins,
      owned: this.#save.ownedVehicles,
      active: this.#car.def.id,
    })
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
    this.#refreshGarage()
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
    //
    // `setVehicle` first, and before the upgrades: importing a save whose
    // active car was the bus used to leave the player driving whatever they
    // had before, with the imported save then written straight back out —
    // silently rewriting the file they had just loaded. It also has to come
    // before applyUpgrades, because it constructs a NEW Vehicle3D and the
    // upgrades would otherwise be applied to the car it replaced.
    this.setVehicle(this.#save.activeVehicle)
    this.#car.applyUpgrades(computeEffects(this.#save.upgrades))

    // Adopt the imported roster wholesale, then drop anyone assigned to a car
    // the imported save does not own.
    this.#company.load(this.#save.drivers)
    this.#company.prune(this.#save.ownedVehicles)
    this.#save.drivers = this.#company.toJSON()

    this.#hud.setCoins(this.#save.coins, true)
    this.#hud.setMuted(this.#save.muted)
    this.#deps.settings.set('muted', this.#save.muted)
    this.#rides.ridesCompleted = this.#save.totalRides
    this.#depot.setFleet(this.#save.ownedVehicles, this.#save.activeVehicle)
    this.#refreshShop()
    this.#refreshGarage()
    this.#refreshCompany()

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
      previewVehicle: (id: string): void => this.setVehicle(id),
      buyVehicle: (id: string): boolean => this.buyVehicle(id),
      owned: (): unknown => [...this.#save.ownedVehicles],
      openGarage: (): void => this.openGarage(),
      fastTravel: (): void => this.fastTravelToDepot(),
      toggleFoot: (): void => this.toggleOnFoot(),
      onFoot: (): boolean => this.#onFoot,
      /** Put the car down anywhere, to test that the world follows it. */
      teleport: (x: number, z: number, heading = 0): void => {
        this.#car.place(x, z, heading)
        this.#world.refresh(x, z)
        this.#traffic.reset(x, z)
        this.#crowd.reset(x, z)
        this.#autoPath.length = 0
      },
      /** What the streamed world looks like wherever the car currently is. */
      worldAt: (): unknown => ({
        spots: this.#world.sidewalkSpots.length,
        obstacles: this.#world.obstacles.size,
        roadDistance: this.#world.roads.nearestRoad(this.#car.x, this.#car.z).distance,
        blockSize: this.#world.roads.blockSize,
      }),
      /** Walk forward for a number of seconds, through the real controls. */
      walk: (seconds: number): void => {
        const avatar = this.#avatar
        if (!avatar) return
        avatar.controls.throttle = 1
        avatar.controls.brake = 0
        avatar.controls.steer = 0
        const dt = 1 / 60
        for (let i = 0; i < Math.round(seconds / dt); i++) avatar.update(dt)
        avatar.controls.throttle = 0
      },
      /** Run the company clock forward without waiting in real time. */
      advanceCompany: (seconds: number): void => {
        this.#company.update(seconds, this.#car.def.id)
      },
      cityLife: (): unknown => ({
        traffic: this.#traffic.activeCount,
        pedestrians: this.#crowd.activeCount,
      }),
      hireDriver: (id: string): boolean => this.#hireDriver(id),
      drivers: (): unknown => this.#company.drivers.map((d) => ({ ...d })),
      incomePerMinute: (): number => this.#company.incomePerMinute(this.#car.def.id),
      depot: (): unknown => ({ x: DEPOT_X, z: DEPOT_Z }),
      avatar: (): unknown =>
        this.#avatar ? { x: this.#avatar.x, z: this.#avatar.z } : null,
      /** The post chain, for tuning AO from the console. Dev only. */
      post: (): unknown => this.#post,
      activeVehicle: (): string => this.#car.def.id,
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
        const near = this.#world.roads.nearestRoad(this.#car.x, this.#car.z)
        this.#car.place(near.x, near.z, near.tangent)
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
    const roads = this.#world.roads
    const b = roads.blockSize

    // No clamping any more: the grid runs in both directions without limit,
    // so a junction index is just a rounded coordinate and every integer is a
    // real place.
    const startCol = Math.round(this.#car.x / b)
    const startRow = Math.round(this.#car.z / b)
    const endCol = Math.round(x / b)
    const endRow = Math.round(z / b)

    const path: Array<{ x: number; z: number }> = []

    // Get onto tarmac first, via the CLOSEST POINT ON A ROAD rather than the
    // nearest junction. Pickups and dropoffs happen on the pavement, and a
    // straight line from there to a junction cuts diagonally through the
    // middle of a building block — which is exactly how the car ends up
    // wedged between two buildings with the throttle down.
    const near = roads.nearestRoad(this.#car.x, this.#car.z)
    path.push({ x: near.x, z: near.z })

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
