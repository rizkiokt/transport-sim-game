/**
 * Car physics on the ground plane.
 *
 * The model is the same forgiving arcade one the 2D build proved out — it
 * was always a 2D simulation on a plane, so it ports directly; only the axis
 * names change (y became z, and y is now up). Everything that made it
 * kid-friendly is preserved:
 *
 * - Hold to go, release to coast to a friendly stop. No gears, no stalling.
 * - Road assist blends heading toward the road and eases the car toward the
 *   centreline, scaled down while the child is deliberately steering — it
 *   catches drift without vetoing a turn.
 * - Grass is slow, never damaging. Collisions push out and slide.
 * - Brake held at a standstill creeps backwards, so no corner is a trap.
 * - Steering authority ramps with speed: the car cannot pirouette in place.
 *
 * New in 3D: visual state for the body (pitch under braking, roll into
 * turns, wheel spin, steering angle) which the model layer consumes.
 */

import { clamp, damp, moveTowards, angleDelta } from '../../engine/math/scalar.js'
import type { VehicleDef } from '../../content/vehicles.js'
import type { City3D, Obstacle3D } from '../world/city3d.js'
import { WORLD_SCALE } from '../world/city3d.js'
import type { RoadPoint } from '../world/road-network.js'

export interface VehicleControls {
  /** 0..1 */
  throttle: number
  /** 0..1 — brakes, then slow reverse once stopped. */
  brake: number
  /** -1..1, positive turns right. */
  steer: number
}

export interface ImpactEvent {
  x: number
  z: number
  /** Speed lost in the hit. */
  severity: number
}

const GRASS_SPEED_FACTOR = 0.5
const ASSIST_HEADING_RATE = 3.2
const ASSIST_CENTERING_RATE = 1.4

export class Vehicle3D {
  /** Position on the ground plane. */
  x = 0
  z = 0
  /** Radians; 0 faces +X. */
  heading = 0
  /** Signed speed along the heading, world units/second. Negative = reverse. */
  speed = 0

  def: VehicleDef

  readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0 }

  impact: ImpactEvent | null = null
  onRoad = true

  /** Visual state, all smoothed, consumed by the model layer. */
  visualPitch = 0
  visualRoll = 0
  /** Accumulated wheel rotation, radians. */
  wheelSpin = 0
  /** Smoothed steering angle for the front wheels, radians. */
  steerAngle = 0

  /** Collision radius in world units. Derived from the car's width. */
  readonly bodyRadius: number

  /** Top speed in world units/second, converted from the content data. */
  readonly maxSpeed: number

  readonly #city: City3D
  readonly #roadScratch: RoadPoint = { x: 0, y: 0, tangent: 0, distance: 0, segmentIndex: -1 }
  readonly #obstacleScratch: Obstacle3D[] = []
  #prevSpeed = 0

  /** Wheel radius, for rolling the wheels at the right rate. */
  readonly #wheelRadius: number

  constructor(city: City3D, def: VehicleDef) {
    this.#city = city
    this.def = def
    this.maxSpeed = def.handling.maxSpeed * WORLD_SCALE
    this.bodyRadius = def.art.width * WORLD_SCALE * 0.62
    this.#wheelRadius = def.art.width * WORLD_SCALE * 0.29
  }

  place(x: number, z: number, heading: number): void {
    this.x = x
    this.z = z
    this.heading = heading
    this.speed = 0
    this.impact = null
    this.visualPitch = 0
    this.visualRoll = 0
    this.steerAngle = 0
  }

  /** Velocity components on the ground plane. */
  get vx(): number {
    return Math.cos(this.heading) * this.speed
  }

  get vz(): number {
    return Math.sin(this.heading) * this.speed
  }

  /** 0..1 fraction of top speed, for camera and audio. */
  get speedFraction(): number {
    return Math.abs(this.speed) / this.maxSpeed
  }

  update(dt: number): void {
    this.impact = null
    this.#prevSpeed = this.speed

    const { throttle, brake, steer } = this.controls
    const handling = this.def.handling

    // -- Surface ----------------------------------------------------------
    // The road network still thinks in 2D layout units, so convert.
    const road = this.#city.roads.nearestRoad(
      this.x / WORLD_SCALE,
      this.z / WORLD_SCALE,
      this.#roadScratch,
    )
    const roadDistance = road.distance * WORLD_SCALE
    const halfRoad = (this.#city.roads.roadWidth / 2) * WORLD_SCALE
    this.onRoad = roadDistance <= halfRoad + 0.5

    const surfaceMax = this.onRoad ? this.maxSpeed : this.maxSpeed * GRASS_SPEED_FACTOR
    const accel = this.maxSpeed / handling.accelTime
    const reverseMax = handling.reverseSpeed * WORLD_SCALE

    // -- Longitudinal -------------------------------------------------------
    if (throttle > 0 && this.speed >= 0) {
      this.speed = moveTowards(this.speed, surfaceMax * throttle, accel * dt)
    } else if (brake > 0) {
      if (this.speed > 0.1) {
        this.speed = moveTowards(this.speed, 0, accel * 2.2 * dt)
      } else {
        this.speed = moveTowards(this.speed, -reverseMax * brake, accel * 0.8 * dt)
      }
    } else {
      this.speed = moveTowards(this.speed, 0, accel * 0.55 * dt)
    }

    this.speed = clamp(this.speed, -reverseMax, surfaceMax)

    // -- Steering -----------------------------------------------------------
    const speedAbs = Math.abs(this.speed)
    const authority =
      clamp(speedAbs / (this.maxSpeed * 0.27), 0, 1) * (1 - 0.25 * clamp(this.speedFraction, 0, 1))
    const steerSense = this.speed < 0 ? -1 : 1
    this.heading += steer * steerSense * handling.steerRate * authority * dt

    // -- Road assist ---------------------------------------------------------
    if (speedAbs > this.maxSpeed * 0.09) {
      // Roads are two-way; aim at whichever direction we're already going.
      let target = road.tangent
      if (Math.abs(angleDelta(this.heading, target)) > Math.PI / 2) target += Math.PI
      const delta = angleDelta(this.heading, target)

      // How much this road runs the way we are travelling: 1 when we are
      // following it, 0 when we are crossing it at right angles.
      //
      // This gate matters more than it looks. At an intersection the *nearest*
      // road is the one we are crossing, and without this the assist would
      // grab the car and try to turn it onto the side street mid-junction —
      // the car visibly fighting the child as they drive straight through.
      // Alignment falls to zero there, the assist lets go, and it re-engages
      // smoothly if they actually do turn onto that street.
      const alignment = Math.cos(delta)

      const nearness = clamp(1 - roadDistance / (halfRoad + 2.2), 0, 1)
      const deliberate = 1 - Math.abs(steer) * 0.85
      const assist = nearness * deliberate * clamp((alignment - 0.5) / 0.5, 0, 1)

      if (assist > 0.01) {
        this.heading += delta * Math.min(1, ASSIST_HEADING_RATE * assist * dt)

        const pull = Math.min(1, ASSIST_CENTERING_RATE * assist * dt)
        this.x += (road.x * WORLD_SCALE - this.x) * pull
        this.z += (road.y * WORLD_SCALE - this.z) * pull
      }
    }

    // -- Integrate ------------------------------------------------------------
    this.x += Math.cos(this.heading) * this.speed * dt
    this.z += Math.sin(this.heading) * this.speed * dt

    this.#resolveCollisions()
    this.#clampToBounds()

    // -- Visual state ---------------------------------------------------------
    // Pitch: nose dives under braking, lifts under acceleration.
    const accelRate = (this.speed - this.#prevSpeed) / Math.max(dt, 0.0001)
    const targetPitch = clamp(-accelRate / (accel * 3), -1, 1) * 0.055
    this.visualPitch = damp(this.visualPitch, targetPitch, 0.0015, dt)

    // Roll: leans out of the turn like a soft-sprung toy car.
    const targetRoll = -steer * clamp(this.speedFraction, 0, 1) * 0.1
    this.visualRoll = damp(this.visualRoll, targetRoll, 0.002, dt)

    this.steerAngle = damp(this.steerAngle, steer * 0.5, 0.0008, dt)
    this.wheelSpin += (this.speed / this.#wheelRadius) * dt
  }

  #resolveCollisions(): void {
    const scratch = this.#obstacleScratch
    scratch.length = 0
    this.#city.obstacles.queryRadius(this.x, this.z, this.bodyRadius + 6, scratch)

    for (const ob of scratch) {
      if (ob.kind === 'building') {
        this.#resolveAabb(ob.x - ob.hw, ob.y - ob.hh, ob.x + ob.hw, ob.y + ob.hh)
      } else {
        this.#resolveCircle(ob.x, ob.y, ob.r)
      }
    }
  }

  #resolveAabb(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const closestX = clamp(this.x, minX, maxX)
    const closestZ = clamp(this.z, minZ, maxZ)
    const dx = this.x - closestX
    const dz = this.z - closestZ
    const distSq = dx * dx + dz * dz
    const r = this.bodyRadius

    if (distSq >= r * r) return

    let nx: number
    let nz: number
    let pen: number

    if (distSq > 0.000001) {
      const dist = Math.sqrt(distSq)
      nx = dx / dist
      nz = dz / dist
      pen = r - dist
    } else {
      // Centre inside the box: escape along the shallowest axis.
      const left = this.x - minX
      const right = maxX - this.x
      const top = this.z - minZ
      const bottom = maxZ - this.z
      const min = Math.min(left, right, top, bottom)
      if (min === left) {
        nx = -1
        nz = 0
        pen = left + r
      } else if (min === right) {
        nx = 1
        nz = 0
        pen = right + r
      } else if (min === top) {
        nx = 0
        nz = -1
        pen = top + r
      } else {
        nx = 0
        nz = 1
        pen = bottom + r
      }
    }

    this.#pushOut(nx, nz, pen)
  }

  #resolveCircle(cx: number, cz: number, radius: number): void {
    const dx = this.x - cx
    const dz = this.z - cz
    const combined = this.bodyRadius + radius
    const distSq = dx * dx + dz * dz
    if (distSq >= combined * combined || distSq < 0.000001) return

    const dist = Math.sqrt(distSq)
    this.#pushOut(dx / dist, dz / dist, combined - dist)
  }

  #pushOut(nx: number, nz: number, penetration: number): void {
    this.x += nx * penetration
    this.z += nz * penetration

    const vx = this.vx
    const vz = this.vz
    const into = vx * nx + vz * nz
    if (into >= 0) return

    // Remove the component driving into the surface; keep the slide.
    const slideX = vx - into * nx
    const slideZ = vz - into * nz
    const newSpeed = Math.hypot(slideX, slideZ)
    const sign = this.speed < 0 ? -1 : 1
    const severity = Math.abs(this.speed) - newSpeed

    if (newSpeed > 0.05) {
      this.heading = Math.atan2(slideZ * sign, slideX * sign)
    }
    this.speed = newSpeed * sign

    if (severity > this.maxSpeed * 0.18) {
      this.impact = {
        x: this.x - nx * this.bodyRadius,
        z: this.z - nz * this.bodyRadius,
        severity,
      }
    } else if (this.impact === null && severity > 0) {
      this.impact = { x: this.x, z: this.z, severity: 0 }
    }
  }

  #clampToBounds(): void {
    const b = this.#city.bounds
    const cx = clamp(this.x, b.minX, b.maxX)
    const cz = clamp(this.z, b.minZ, b.maxZ)
    if (cx !== this.x || cz !== this.z) {
      this.x = cx
      this.z = cz
      this.speed *= 0.6
    }
  }
}
