/**
 * The ride loop in 3D: a passenger waits and waves, the child drives over,
 * they hop in, a beacon appears at their destination, and delivering them
 * pays coins.
 *
 * The forgiveness rules carry over unchanged, because they are the whole
 * reason this works for a 6-year-old: generous trigger radii, no timers, no
 * impatience, no way to fail. Destinations start close and lengthen as rides
 * complete, so the first sessions are quick win after quick win.
 *
 * New in 3D: the destination is a tall rotating beacon of light rather than a
 * flat pin. Height is what makes it findable — a marker on the ground
 * disappears behind the first building, but a beam is visible over the
 * rooftops from anywhere in town.
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Scene,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three'

import { clamp, lerp } from '../../engine/math/scalar.js'
import { cosmeticRng } from '../../engine/math/rng.js'
import { outQuad, pulse } from '../../engine/anim/easing.js'
import { createCharacter, disposeCharacter, type CharacterParts } from '../art/character-model.js'
import type { Vehicle3D } from '../entities/vehicle3d.js'
import type { City3D } from '../world/city3d.js'

export type RidePhase = 'waiting' | 'boarding' | 'riding' | 'arriving' | 'gap'

export interface RideEvents {
  onPickup(x: number, y: number, z: number): void
  onDropoff(fare: number, x: number, y: number, z: number): void
}

/**
 * Trigger radii in world units. Deliberately generous — no parking skill
 * needed, and no speed gate at all.
 *
 * An earlier version required the car to slow below 45% of top speed to pick
 * up or drop off. A headless playtest promptly drove straight past a
 * passenger at full throttle and never collected them, which is exactly the
 * failure a 6-year-old would hit: an invisible skill gate that silently
 * refuses the reward and gives no reason why. Touching the passenger is now
 * enough, at any speed. The boarding animation makes even a fast pickup read
 * as intentional, because the passenger hops toward the moving car.
 */
const PICKUP_RADIUS = 3.6
const DROPOFF_RADIUS = 5
const BOARD_TIME = 0.55
const CELEBRATE_TIME = 1.8
const GAP_TIME = 1.1

const BEACON_COLORS = [0xff5a5a, 0x4cc9f0, 0xffc93c, 0x43c465, 0xa06ae8]

export class RideSystem3D {
  phase: RidePhase = 'gap'

  /** Where the compass should point, world units. */
  targetX = 0
  targetZ = 0
  hasTarget = false

  ridesCompleted: number

  /** Colour of the current ride, shared by the beacon and the compass. */
  color = BEACON_COLORS[0]!

  #passengerX = 0
  #passengerZ = 0
  #destX = 0
  #destZ = 0
  #fare = 0
  #phaseTime = 0
  #time = 0

  readonly #city: City3D
  readonly #events: RideEvents
  readonly #scene: Scene

  #character: CharacterParts | null = null
  readonly #beacon: Group
  readonly #beaconBeam: Mesh
  readonly #beaconRing: Mesh
  readonly #beaconMaterial: MeshBasicMaterial
  readonly #ringMaterial: MeshLambertMaterial
  readonly #disposables: Array<BufferGeometry | Material> = []

  constructor(scene: Scene, city: City3D, events: RideEvents, ridesCompleted: number) {
    this.#scene = scene
    this.#city = city
    this.#events = events
    this.ridesCompleted = ridesCompleted

    // -- Beacon ----------------------------------------------------------
    this.#beacon = new Group()
    this.#beacon.visible = false

    const beamGeo = new CylinderGeometry(0.42, 0.68, 14, 10, 1, true)
    this.#disposables.push(beamGeo)
    this.#beaconMaterial = new MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    })
    this.#disposables.push(this.#beaconMaterial)
    this.#beaconBeam = new Mesh(beamGeo, this.#beaconMaterial)
    this.#beaconBeam.position.y = 7
    this.#beacon.add(this.#beaconBeam)

    const ringGeo = new TorusGeometry(1.5, 0.16, 8, 24)
    this.#disposables.push(ringGeo)
    this.#ringMaterial = new MeshLambertMaterial({
      color: this.color,
      emissive: this.color,
      emissiveIntensity: 0.6,
    })
    this.#disposables.push(this.#ringMaterial)
    this.#beaconRing = new Mesh(ringGeo, this.#ringMaterial)
    this.#beaconRing.rotation.x = -Math.PI / 2
    this.#beaconRing.position.y = 0.2
    this.#beacon.add(this.#beaconRing)

    scene.add(this.#beacon)

    // Start part-way through the gap so the first passenger appears just
    // after the scene settles, drawing the eye with their spawn.
    this.#phaseTime = GAP_TIME * 0.4
  }

  get passengerX(): number {
    return this.#passengerX
  }

  get passengerZ(): number {
    return this.#passengerZ
  }

  update(dt: number, car: Vehicle3D): void {
    this.#time += dt

    switch (this.phase) {
      case 'gap': {
        this.hasTarget = false
        this.#phaseTime -= dt
        if (this.#phaseTime <= 0) this.#spawnPassenger(car)
        break
      }

      case 'waiting': {
        this.targetX = this.#passengerX
        this.targetZ = this.#passengerZ
        this.hasTarget = true

        const dist = Math.hypot(car.x - this.#passengerX, car.z - this.#passengerZ)
        this.#animateWaiting(dist)

        if (dist < PICKUP_RADIUS) {
          this.phase = 'boarding'
          this.#phaseTime = 0
          this.#events.onPickup(this.#passengerX, 0.6, this.#passengerZ)
        }
        break
      }

      case 'boarding': {
        // No target while boarding: the old pickup point must not linger as a
        // stale compass heading for even one frame.
        this.hasTarget = false
        this.#phaseTime += dt
        this.#animateBoarding(car)
        if (this.#phaseTime >= BOARD_TIME) {
          this.phase = 'riding'
          this.#hideCharacter()
          this.#chooseDestination(car)
        }
        break
      }

      case 'riding': {
        this.targetX = this.#destX
        this.targetZ = this.#destZ
        this.hasTarget = true
        this.#animateBeacon(dt)

        const dist = Math.hypot(car.x - this.#destX, car.z - this.#destZ)
        if (dist < DROPOFF_RADIUS) {
          this.phase = 'arriving'
          this.#phaseTime = 0
          this.#passengerX = this.#destX
          this.#passengerZ = this.#destZ
          this.ridesCompleted++
          this.#beacon.visible = false
          this.#showCharacterAt(this.#destX, this.#destZ)
          this.#events.onDropoff(this.#fare, this.#destX, 0.8, this.#destZ)
        }
        break
      }

      case 'arriving': {
        this.hasTarget = false
        this.#phaseTime += dt
        this.#animateCelebrating()
        if (this.#phaseTime >= CELEBRATE_TIME) {
          this.phase = 'gap'
          this.#phaseTime = GAP_TIME
          this.#hideCharacter()
        }
        break
      }
    }
  }

  // ------------------------------------------------------------ animation

  #animateWaiting(distToCar: number): void {
    const c = this.#character
    if (!c) return

    // Wave harder as the car approaches: the passenger noticed you.
    const excitement = clamp(1 - distToCar / 26, 0, 1)
    const hop = Math.abs(Math.sin(this.#time * (3 + excitement * 5)))
    c.body.position.y = hop * (0.04 + excitement * 0.12)
    c.arm.rotation.z = -0.5 - Math.sin(this.#time * 9) * 0.85 * excitement
    // Face the car so the wave reads as directed at the player.
    c.root.rotation.y = lerp(c.root.rotation.y, c.root.rotation.y, 1)
  }

  #animateBoarding(car: Vehicle3D): void {
    const c = this.#character
    if (!c) return
    const t = clamp(this.#phaseTime / BOARD_TIME, 0, 1)
    const eased = outQuad(t)

    // Hop toward the (possibly moving) car, rising through an arc and
    // shrinking as they climb in.
    c.root.position.x = lerp(this.#passengerX, car.x, eased)
    c.root.position.z = lerp(this.#passengerZ, car.z, eased)
    c.body.position.y = pulse(t) * 0.9
    const shrink = 1 - t * 0.75
    c.root.scale.setScalar(Math.max(0.001, shrink))
  }

  #animateCelebrating(): void {
    const c = this.#character
    if (!c) return
    c.body.position.y = Math.abs(Math.sin(this.#time * 8)) * 0.3
    c.arm.rotation.z = -1.4 - Math.sin(this.#time * 12) * 0.6
    c.root.rotation.y += 0.05
  }

  #animateBeacon(dt: number): void {
    void dt
    this.#beacon.rotation.y = this.#time * 1.2
    const breathe = 1 + Math.sin(this.#time * 2.6) * 0.12
    this.#beaconRing.scale.setScalar(breathe)
    this.#beaconMaterial.opacity = 0.22 + Math.sin(this.#time * 2.6) * 0.09
  }

  // ------------------------------------------------------------ lifecycle

  #spawnPassenger(car: Vehicle3D): void {
    const seed = this.ridesCompleted * 7919 + Math.floor(this.#time * 1000)
    const spot =
      this.#pickSpot(car.x, car.z, 18, 55) ?? this.#pickSpot(car.x, car.z, 0, Infinity)
    if (!spot) return

    this.#passengerX = spot.x
    this.#passengerZ = spot.z
    this.color = BEACON_COLORS[seed % BEACON_COLORS.length]!
    this.#beaconMaterial.color.setHex(this.color)
    this.#ringMaterial.color.setHex(this.color)
    this.#ringMaterial.emissive.setHex(this.color)

    this.#replaceCharacter(seed)
    this.#showCharacterAt(spot.x, spot.z)
    this.phase = 'waiting'
  }

  #chooseDestination(car: Vehicle3D): void {
    const minD = 26
    const maxD = Math.min(125, 46 + this.ridesCompleted * 5)
    const spot = this.#pickSpot(car.x, car.z, minD, maxD) ?? this.#pickSpot(car.x, car.z, 16, Infinity)
    if (!spot) return

    this.#destX = spot.x
    this.#destZ = spot.z
    // Publish the target the same tick it is chosen, so nothing reads a
    // stale heading.
    this.targetX = spot.x
    this.targetZ = spot.z
    this.hasTarget = true

    this.#beacon.position.set(spot.x, 0, spot.z)
    this.#beacon.visible = true

    const dist = Math.hypot(spot.x - car.x, spot.z - car.z)
    this.#fare = 10 + Math.round(dist / 16) * 5
  }

  #replaceCharacter(seed: number): void {
    this.#disposeCharacter()
    this.#character = createCharacter(seed)
    this.#scene.add(this.#character.root)
  }

  #showCharacterAt(x: number, z: number): void {
    const c = this.#character
    if (!c) return
    c.root.position.set(x, 0, z)
    c.root.scale.setScalar(1)
    c.root.visible = true
  }

  #hideCharacter(): void {
    if (this.#character) this.#character.root.visible = false
  }

  #disposeCharacter(): void {
    if (!this.#character) return
    this.#scene.remove(this.#character.root)
    disposeCharacter(this.#character)
    this.#character = null
  }

  #pickSpot(
    x: number,
    z: number,
    minDist: number,
    maxDist: number,
  ): { x: number; z: number } | null {
    const spots = this.#city.sidewalkSpots
    if (spots.length === 0) return null

    for (let attempt = 0; attempt < 24; attempt++) {
      const spot = spots[Math.floor(cosmeticRng.next() * spots.length)]!
      const dist = Math.hypot(spot.x - x, spot.z - z)
      if (dist >= minDist && dist <= maxDist) return spot
    }

    // Nothing in the band — take whatever is closest to it.
    let best: { x: number; z: number } | null = null
    let bestScore = Infinity
    for (const spot of spots) {
      const dist = Math.hypot(spot.x - x, spot.z - z)
      const score = dist < minDist ? minDist - dist : dist > maxDist ? dist - maxDist : 0
      if (score < bestScore) {
        bestScore = score
        best = spot
      }
    }
    return best
  }

  dispose(): void {
    this.#disposeCharacter()
    this.#scene.remove(this.#beacon)
    for (const d of this.#disposables) d.dispose()
    this.#disposables.length = 0
  }
}
