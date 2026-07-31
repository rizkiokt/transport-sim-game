/**
 * The ride loop: a passenger waits, the child drives over, the passenger
 * hops in, a destination pin appears, and delivering them pays coins.
 *
 * Deliberately forgiving:
 * - Pickup and dropoff trigger from generous radii at any "slow-ish" speed —
 *   no parking precision required.
 * - There is no timer, no impatience, no cancellation. A passenger waits
 *   forever, happily.
 * - Destinations start close and stretch as the child completes rides, so
 *   the first sessions are quick win after quick win.
 *
 * The system owns passenger state and world-space rendering of passengers
 * and the destination pin. Money, sound, and celebration effects belong to
 * the scene, reached through {@link RideEvents}.
 */

import { clamp, lerp } from '../../engine/math/scalar.js'
import { cosmeticRng } from '../../engine/math/rng.js'
import { outQuad, pulse } from '../../engine/anim/easing.js'
import {
  drawCharacter,
  generateLook,
  type CharacterLook,
  type CharacterPose,
} from '../art/character-art.js'
import { drawDestinationPin, drawSymbolBubble, rollSymbol, type RideSymbol } from '../art/symbols.js'
import type { PlayerVehicle } from '../entities/player-vehicle.js'
import type { City } from '../world/city.js'

export type RidePhase = 'waiting' | 'boarding' | 'riding' | 'arriving' | 'gap'

export interface RideEvents {
  onPickup(x: number, y: number): void
  onDropoff(fare: number, x: number, y: number): void
}

/** Pickup triggers inside this range of the waiting passenger. */
const PICKUP_RADIUS = 60
/** Dropoff triggers inside this range of the pin. */
const DROPOFF_RADIUS = 85
/** Above this speed the car is "driving past", not stopping. */
const TRIGGER_MAX_SPEED = 95
/** Seconds the boarding hop takes. */
const BOARD_TIME = 0.5
/** Seconds the passenger celebrates after arriving. */
const CELEBRATE_TIME = 1.6
/** Seconds between a dropoff and the next passenger appearing. */
const GAP_TIME = 1.0

export class RideSystem {
  phase: RidePhase = 'gap'

  /** Where the HUD arrow should point right now, or null. */
  targetX = 0
  targetY = 0
  hasTarget = false

  /** Fares scale with rides completed this install — mirrors save.totalRides. */
  ridesCompleted: number

  #passengerX = 0
  #passengerY = 0
  #destX = 0
  #destY = 0
  #look: CharacterLook
  #symbol: RideSymbol
  #fare = 0

  /** Progress through the current timed phase (boarding/arriving/gap). */
  #phaseTime = 0

  #time = 0
  #rideSeed: number

  readonly #city: City
  readonly #events: RideEvents
  readonly #pose: CharacterPose = { bounce: 0, wave: 0, wavePhase: 0 }

  constructor(city: City, events: RideEvents, ridesCompleted: number) {
    this.#city = city
    this.#events = events
    this.ridesCompleted = ridesCompleted
    this.#rideSeed = ridesCompleted
    this.#look = generateLook(this.#rideSeed)
    this.#symbol = rollSymbol(this.#rideSeed)
    // Start in the gap phase so the first passenger appears just after the
    // scene fades in, drawing the eye with its spawn pop.
    this.#phaseTime = GAP_TIME * 0.5
  }

  get passengerX(): number {
    return this.#passengerX
  }

  get passengerY(): number {
    return this.#passengerY
  }

  get symbol(): RideSymbol {
    return this.#symbol
  }

  update(dt: number, car: PlayerVehicle): void {
    this.#time += dt
    const speed = Math.abs(car.speed)

    switch (this.phase) {
      case 'gap': {
        this.#phaseTime -= dt
        this.hasTarget = false
        if (this.#phaseTime <= 0) this.#spawnPassenger(car)
        break
      }

      case 'waiting': {
        this.targetX = this.#passengerX
        this.targetY = this.#passengerY
        this.hasTarget = true

        const dx = car.x - this.#passengerX
        const dy = car.y - this.#passengerY
        const dist = Math.hypot(dx, dy)

        // Wave harder as the car approaches — the passenger noticed you!
        this.#pose.wave = clamp(1 - dist / 420, 0, 1)
        this.#pose.wavePhase = this.#time * 9
        this.#pose.bounce =
          -Math.abs(Math.sin(this.#time * (3 + this.#pose.wave * 5))) * (2 + this.#pose.wave * 6)

        if (dist < PICKUP_RADIUS && speed < TRIGGER_MAX_SPEED) {
          this.phase = 'boarding'
          this.#phaseTime = 0
          this.#events.onPickup(this.#passengerX, this.#passengerY)
        }
        break
      }

      case 'boarding': {
        // No target while the passenger hops in — the old pickup point must
        // not linger as a stale arrow target.
        this.hasTarget = false
        this.#phaseTime += dt
        if (this.#phaseTime >= BOARD_TIME) {
          this.phase = 'riding'
          this.#chooseDestination(car)
        }
        break
      }

      case 'riding': {
        this.targetX = this.#destX
        this.targetY = this.#destY
        this.hasTarget = true

        const dist = Math.hypot(car.x - this.#destX, car.y - this.#destY)
        if (dist < DROPOFF_RADIUS && speed < TRIGGER_MAX_SPEED) {
          this.phase = 'arriving'
          this.#phaseTime = 0
          this.#passengerX = this.#destX
          this.#passengerY = this.#destY
          this.ridesCompleted++
          this.#events.onDropoff(this.#fare, this.#destX, this.#destY)
        }
        break
      }

      case 'arriving': {
        this.#phaseTime += dt
        this.hasTarget = false
        // Happy arrival jumps.
        this.#pose.wave = 1
        this.#pose.wavePhase = this.#time * 10
        this.#pose.bounce = -Math.abs(Math.sin(this.#time * 8)) * 7

        if (this.#phaseTime >= CELEBRATE_TIME) {
          this.phase = 'gap'
          this.#phaseTime = GAP_TIME
        }
        break
      }
    }
  }

  /** World-space rendering: waiting/celebrating passenger, bubble, pin. */
  render(ctx: CanvasRenderingContext2D, carX: number, carY: number): void {
    if (this.phase === 'waiting' || this.phase === 'arriving') {
      ctx.save()
      ctx.translate(this.#passengerX, this.#passengerY)
      drawCharacter(ctx, this.#look, this.#pose)
      ctx.restore()

      if (this.phase === 'waiting') {
        // The "I want to go somewhere!" bubble, gently bobbing.
        ctx.save()
        ctx.translate(
          this.#passengerX,
          this.#passengerY - 46 + Math.sin(this.#time * 2.4) * 2.5,
        )
        drawSymbolBubble(ctx, this.#symbol, 13)
        ctx.restore()
      }
    }

    if (this.phase === 'boarding') {
      // Hop from the sidewalk into the (possibly moving) car: chase the car
      // while rising through a little jump arc.
      const t = clamp(this.#phaseTime / BOARD_TIME, 0, 1)
      const eased = outQuad(t)
      const x = lerp(this.#passengerX, carX, eased)
      const y = lerp(this.#passengerY, carY, eased) - pulse(t) * 22

      ctx.save()
      ctx.translate(x, y)
      const shrink = 1 - t * 0.5
      ctx.scale(shrink, shrink)
      drawCharacter(ctx, this.#look, this.#pose)
      ctx.restore()
    }

    if (this.phase === 'riding') {
      const bob = Math.sin(this.#time * 3) * 3
      const seg = (this.#time * 0.9) % 1
      ctx.save()
      ctx.translate(this.#destX, this.#destY)
      drawDestinationPin(ctx, this.#symbol, 52, seg, bob)
      ctx.restore()
    }
  }

  #spawnPassenger(car: PlayerVehicle): void {
    this.#rideSeed = this.ridesCompleted * 7919 + Math.floor(this.#time * 1000) % 7919
    this.#look = generateLook(this.#rideSeed)
    this.#symbol = rollSymbol(this.#rideSeed)

    // Near enough to reach quickly, far enough to require a little drive.
    const spot = this.#pickSpot(car.x, car.y, 240, 700) ?? this.#pickSpot(car.x, car.y, 0, Infinity)
    if (!spot) return // No sidewalk spots at all — impossible in practice.

    this.#passengerX = spot.x
    this.#passengerY = spot.y
    this.phase = 'waiting'
  }

  #chooseDestination(car: PlayerVehicle): void {
    // Trips lengthen as the child completes rides: quick wins first.
    const minD = 320
    const maxD = Math.min(1500, 560 + this.ridesCompleted * 60)

    const spot =
      this.#pickSpot(car.x, car.y, minD, maxD) ?? this.#pickSpot(car.x, car.y, 200, Infinity)
    if (!spot) return

    this.#destX = spot.x
    this.#destY = spot.y
    // Publish the target in the same tick the destination is chosen —
    // otherwise the guidance arrow points at the stale pickup spot for a
    // frame (and anything reading the target that frame goes the wrong way).
    this.targetX = spot.x
    this.targetY = spot.y
    this.hasTarget = true

    // Fare: a base plus distance, in friendly round numbers a 6-year-old can
    // watch tick up. Vehicle multipliers come in with the garage.
    const dist = Math.hypot(spot.x - car.x, spot.y - car.y)
    this.#fare = 10 + Math.round(dist / 200) * 5
  }

  /** A random sidewalk spot whose distance from (x, y) is inside [min, max]. */
  #pickSpot(
    x: number,
    y: number,
    minDist: number,
    maxDist: number,
  ): { x: number; y: number } | null {
    const spots = this.#city.sidewalkSpots
    if (spots.length === 0) return null

    // Rejection-sample a few times, then fall back to the closest-to-band.
    for (let attempt = 0; attempt < 24; attempt++) {
      const spot = spots[Math.floor(cosmeticRng.next() * spots.length)]!
      const dist = Math.hypot(spot.x - x, spot.y - y)
      if (dist >= minDist && dist <= maxDist) return spot
    }

    let best: { x: number; y: number } | null = null
    let bestScore = Infinity
    for (const spot of spots) {
      const dist = Math.hypot(spot.x - x, spot.y - y)
      const score = dist < minDist ? minDist - dist : dist > maxDist ? dist - maxDist : 0
      if (score < bestScore) {
        bestScore = score
        best = spot
      }
    }
    return best
  }
}
