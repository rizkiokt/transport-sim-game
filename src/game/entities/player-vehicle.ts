/**
 * The player's vehicle: arcade car physics tuned for a 6-year-old.
 *
 * Design decisions, each deliberate:
 *
 * - **Hold to go.** Throttle is a held input, releasing coasts to a stop.
 *   There is no gear, no clutch, no stalling.
 * - **Road assist.** When the car is on or near a road, its heading is
 *   gently blended toward the road direction and its position toward the
 *   centreline. The child still steers — assist never fights a deliberate
 *   turn (it scales down with steering input) — but drifting off the road by
 *   accident mostly doesn't happen.
 * - **Off-road is allowed, just slow.** Grass halves the top speed. No
 *   damage, no reset, no failure.
 * - **Collisions are soft.** Buildings and trees push the car out and slide
 *   it along; a firm hit costs speed and produces a "bonk", never a crash.
 * - **Speed-scaled steering.** At a standstill the car cannot spin in place;
 *   at low speed steering is gentle; full agility arrives with speed.
 *   Reversing flips the steering sense so it behaves like a real car, but
 *   reverse is slow and exists only for getting unstuck.
 */

import { clamp, damp, moveTowards, angleDelta } from '../../engine/math/scalar.js'
import type { City, Obstacle } from '../world/city.js'
import type { RoadPoint } from '../world/road-network.js'
import type { VehicleDef } from '../../content/vehicles.js'

export interface VehicleControls {
  /** 0..1 */
  throttle: number
  /** 0..1 — brakes, then slow reverse once stopped. */
  brake: number
  /** -1..1, positive steers right (screen-down when heading +x). */
  steer: number
}

export interface ImpactEvent {
  x: number
  y: number
  /** Speed lost in the hit — proxy for how hard it was. */
  severity: number
}

const GRASS_SPEED_FACTOR = 0.5
/** How strongly assist blends heading toward the road tangent, 1/seconds. */
const ASSIST_HEADING_RATE = 3.2
/** How quickly assist pulls the car toward the centreline, 1/seconds. */
const ASSIST_CENTERING_RATE = 1.4
/** Collision radius of the car, roughly half its width plus a margin. */
const BODY_RADIUS = 16

export class PlayerVehicle {
  x = 0
  y = 0
  /** Radians; 0 = +x. */
  heading = 0
  /** Signed speed along the heading; negative = reversing. */
  speed = 0

  def: VehicleDef

  readonly controls: VehicleControls = { throttle: 0, brake: 0, steer: 0 }

  /** Set for one step when the car hits something solid. */
  impact: ImpactEvent | null = null

  /** True while the car is on asphalt (drives the assist and surface FX). */
  onRoad = true

  /** Smoothed visual state consumed by the renderer. */
  visualStretch = 1
  visualLean = 0

  /** Time spent held against a wall with throttle down — drives the unstick hint. */
  stuckTime = 0

  readonly #city: City
  readonly #roadScratch: RoadPoint = { x: 0, y: 0, tangent: 0, distance: 0, segmentIndex: -1 }
  readonly #obstacleScratch: Obstacle[] = []

  /** Previous-step speed, for detecting collision-caused loss. */
  #prevSpeed = 0

  constructor(city: City, def: VehicleDef) {
    this.#city = city
    this.def = def
  }

  /** Teleport, clearing motion. Used on spawn and by the dev autopilot. */
  place(x: number, y: number, heading: number): void {
    this.x = x
    this.y = y
    this.heading = heading
    this.speed = 0
    this.impact = null
    this.visualStretch = 1
    this.visualLean = 0
  }

  get maxSpeed(): number {
    return this.def.handling.maxSpeed
  }

  /** Forward velocity components, for the camera and particles. */
  get vx(): number {
    return Math.cos(this.heading) * this.speed
  }

  get vy(): number {
    return Math.sin(this.heading) * this.speed
  }

  update(dt: number): void {
    this.impact = null
    this.#prevSpeed = this.speed
    const { throttle, brake, steer } = this.controls
    const handling = this.def.handling

    // -- Surface ---------------------------------------------------------
    const road = this.#city.roads.nearestRoad(this.x, this.y, this.#roadScratch)
    this.onRoad = road.distance <= this.#city.roads.roadWidth / 2 + 6

    const surfaceMax = this.onRoad
      ? handling.maxSpeed
      : handling.maxSpeed * GRASS_SPEED_FACTOR

    // -- Longitudinal ----------------------------------------------------
    const accel = handling.maxSpeed / handling.accelTime

    if (throttle > 0 && this.speed >= 0) {
      this.speed = moveTowards(this.speed, surfaceMax * throttle, accel * dt)
    } else if (brake > 0) {
      if (this.speed > 1) {
        // Braking from motion.
        this.speed = moveTowards(this.speed, 0, accel * 2.2 * dt)
      } else {
        // Held at a standstill: creep backwards to escape corners.
        this.speed = moveTowards(this.speed, -handling.reverseSpeed * brake, accel * 0.8 * dt)
      }
    } else {
      // Coasting: rolling drag brings the car to a friendly halt.
      this.speed = moveTowards(this.speed, 0, accel * 0.55 * dt)
    }

    // Surface cap (also catches "drove onto grass at speed").
    this.speed = clamp(this.speed, -handling.reverseSpeed, surfaceMax)

    // -- Steering ----------------------------------------------------------
    // No spinning in place; authority ramps in with speed, and eases off a
    // touch at the top end so full speed doesn't feel twitchy.
    const speedAbs = Math.abs(this.speed)
    const authority =
      clamp(speedAbs / 60, 0, 1) * (1 - 0.25 * clamp(speedAbs / handling.maxSpeed, 0, 1))
    const steerSense = this.speed < 0 ? -1 : 1
    this.heading += steer * steerSense * handling.steerRate * authority * dt

    // -- Road assist -------------------------------------------------------
    // Assist strength fades with distance from the road and with how hard the
    // child is deliberately steering — it should catch drift, not veto turns.
    if (speedAbs > 20) {
      const halfRoad = this.#city.roads.roadWidth / 2
      const nearness = clamp(1 - road.distance / (halfRoad + 26), 0, 1)
      const deliberate = 1 - Math.abs(steer) * 0.85
      const assist = nearness * deliberate

      if (assist > 0.01) {
        // Blend heading toward whichever direction of the road points more
        // our way (roads are two-way).
        let target = road.tangent
        if (Math.abs(angleDelta(this.heading, target)) > Math.PI / 2) {
          target += Math.PI
        }
        const delta = angleDelta(this.heading, target)
        this.heading += delta * Math.min(1, ASSIST_HEADING_RATE * assist * dt)

        // Ease toward the centreline so the car tracks the lane it's near.
        const pullX = road.x - this.x
        const pullY = road.y - this.y
        const pull = Math.min(1, ASSIST_CENTERING_RATE * assist * dt)
        this.x += pullX * pull
        this.y += pullY * pull
      }
    }

    // -- Integrate ---------------------------------------------------------
    this.x += Math.cos(this.heading) * this.speed * dt
    this.y += Math.sin(this.heading) * this.speed * dt

    this.#resolveCollisions()
    this.#clampToBounds()

    // -- Stuck detection ---------------------------------------------------
    const wantsToMove = throttle > 0.3 || brake > 0.3
    if (wantsToMove && Math.abs(this.speed) < 8 && this.impact !== null) {
      this.stuckTime += dt
    } else if (Math.abs(this.speed) > 30 || !wantsToMove) {
      this.stuckTime = 0
    }

    // -- Cosmetics ---------------------------------------------------------
    const accelAmount = clamp((this.speed - this.#prevSpeed) / (accel * dt + 0.0001), -1, 1)
    this.visualStretch = damp(this.visualStretch, 1 + accelAmount * 0.045, 0.0008, dt)
    this.visualLean = damp(this.visualLean, steer * clamp(speedAbs / handling.maxSpeed, 0, 1) * 0.09, 0.002, dt)
  }

  #resolveCollisions(): void {
    const scratch = this.#obstacleScratch
    scratch.length = 0
    this.#city.obstacles.queryRadius(this.x, this.y, BODY_RADIUS + 90, scratch)

    for (const ob of scratch) {
      if (ob.kind === 'building') {
        this.#resolveAabb(ob.x - ob.hw, ob.y - ob.hh, ob.x + ob.hw, ob.y + ob.hh)
      } else {
        this.#resolveCircle(ob.x, ob.y, ob.r)
      }
    }
  }

  /** Push the car (a circle) out of an AABB, sliding along the surface. */
  #resolveAabb(minX: number, minY: number, maxX: number, maxY: number): void {
    const closestX = clamp(this.x, minX, maxX)
    const closestY = clamp(this.y, minY, maxY)
    const dx = this.x - closestX
    const dy = this.y - closestY
    const distSq = dx * dx + dy * dy

    if (distSq >= BODY_RADIUS * BODY_RADIUS) return

    let nx: number
    let ny: number
    let pen: number

    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq)
      nx = dx / dist
      ny = dy / dist
      pen = BODY_RADIUS - dist
    } else {
      // Centre is inside the box — push out along the shallowest axis.
      const left = this.x - minX
      const right = maxX - this.x
      const top = this.y - minY
      const bottom = maxY - this.y
      const min = Math.min(left, right, top, bottom)
      if (min === left) {
        nx = -1
        ny = 0
        pen = left + BODY_RADIUS
      } else if (min === right) {
        nx = 1
        ny = 0
        pen = right + BODY_RADIUS
      } else if (min === top) {
        nx = 0
        ny = -1
        pen = top + BODY_RADIUS
      } else {
        nx = 0
        ny = 1
        pen = bottom + BODY_RADIUS
      }
    }

    this.#pushOut(nx, ny, pen)
  }

  #resolveCircle(cx: number, cy: number, r: number): void {
    const dx = this.x - cx
    const dy = this.y - cy
    const combined = BODY_RADIUS + r
    const distSq = dx * dx + dy * dy
    if (distSq >= combined * combined || distSq < 0.0001) return

    const dist = Math.sqrt(distSq)
    this.#pushOut(dx / dist, dy / dist, combined - dist)
  }

  /** Shared collision response: positional correction + velocity slide. */
  #pushOut(nx: number, ny: number, penetration: number): void {
    this.x += nx * penetration
    this.y += ny * penetration

    // Remove the velocity component driving into the surface.
    const vx = this.vx
    const vy = this.vy
    const into = vx * nx + vy * ny
    if (into < 0) {
      const slideX = vx - into * nx
      const slideY = vy - into * ny
      const newSpeed = Math.hypot(slideX, slideY)

      // Preserve travel direction sign so a reversing car stays reversing.
      const sign = this.speed < 0 ? -1 : 1
      const severity = Math.abs(this.speed) - newSpeed

      if (newSpeed > 1) {
        this.heading = Math.atan2(slideY * sign, slideX * sign)
      }
      this.speed = newSpeed * sign

      // Only report meaningful bonks, not gentle scrapes.
      if (severity > 40) {
        this.impact = { x: this.x - nx * BODY_RADIUS, y: this.y - ny * BODY_RADIUS, severity }
      } else if (this.impact === null && severity > 0) {
        // Track as a silent touch so stuck detection still works.
        this.impact = { x: this.x, y: this.y, severity: 0 }
      }
    }
  }

  #clampToBounds(): void {
    const b = this.#city.bounds
    const clampedX = clamp(this.x, b.minX, b.maxX)
    const clampedY = clamp(this.y, b.minY, b.maxY)
    if (clampedX !== this.x || clampedY !== this.y) {
      this.x = clampedX
      this.y = clampedY
      this.speed *= 0.6
    }
  }
}
