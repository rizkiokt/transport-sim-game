/**
 * The player, out of the car.
 *
 * Getting out matters more than it sounds. Until now the child *was* the taxi;
 * the company, the depot and the fleet were all things seen through a
 * windscreen. Being able to park, step out, walk into your own garage and
 * choose a different car turns a menu into a place, which is the whole reason
 * the depot exists.
 *
 * The controls are deliberately the same ones that drive: hold to go, drag to
 * turn. A six-year-old who has learned to drive should not have to learn a
 * second control scheme to walk — so this is a slow car with legs, not a
 * first-person controller.
 *
 * Movement is much simpler than the vehicle's: no momentum to speak of, no
 * road assist, no reverse gear. Walking backwards is just walking with the
 * brake held, at half speed.
 */

import { clamp, moveTowards } from '../../engine/math/scalar.js'
import {
  createCharacter,
  disposeCharacter,
  type CharacterParts,
} from '../art/character-model.js'
import type { DriveWorld, Obstacle3D } from '../world/drive-world.js'

/** Comfortable walking speed, world units per second. */
const WALK_SPEED = 3.4
const BACK_SPEED = 1.6
/** Units per second squared. Reaches walking pace in about a quarter second. */
const WALK_ACCEL = 14
const TURN_RATE = 3.1
/** How wide the walker is for collision purposes. */
const BODY_RADIUS = 0.34

export interface AvatarControls {
  /** 0..1 forward. */
  throttle: number
  /** 0..1 backward. */
  brake: number
  /** -1..1, positive turns right. */
  steer: number
}

export class Avatar {
  x = 0
  z = 0
  /** Radians; 0 faces +X. */
  heading = 0
  /** Current ground speed, signed along the heading. */
  speed = 0

  readonly controls: AvatarControls = { throttle: 0, brake: 0, steer: 0 }
  readonly parts: CharacterParts

  readonly #world: DriveWorld
  readonly #obstacleScratch: Obstacle3D[] = []
  /** Walk cycle phase, radians. */
  #phase = 0

  constructor(world: DriveWorld, seed: number | string = 'player') {
    this.#world = world
    this.parts = createCharacter(seed)
  }

  place(x: number, z: number, heading: number): void {
    this.x = x
    this.z = z
    this.heading = heading
    this.speed = 0
    this.#phase = 0
    this.sync()
  }

  update(dt: number): void {
    const { throttle, brake, steer } = this.controls

    // Turning works while standing still — pivoting on the spot is natural on
    // foot, and it is the only way to look around without a camera stick.
    this.heading += steer * TURN_RATE * dt

    const target = throttle > 0 ? WALK_SPEED * throttle : brake > 0 ? -BACK_SPEED * brake : 0
    // A fixed acceleration rather than exponential damping. `damp`'s third
    // argument is the fraction of the gap REMAINING after one second, not a
    // rate — passing a rate-like 12 makes `1 - 12^dt` negative, which drives
    // the value away from its target instead of toward it. That is a silent
    // sign error, and here it made the walker accelerate backwards to five
    // times a car's top speed. moveTowards has no such trap.
    this.speed = moveTowards(this.speed, target, WALK_ACCEL * dt)
    if (Math.abs(this.speed) < 0.01) this.speed = 0

    this.x += Math.cos(this.heading) * this.speed * dt
    this.z += Math.sin(this.heading) * this.speed * dt

    this.#resolveCollisions()

    // Stride rate follows speed, so the legs never skate.
    this.#phase += (Math.abs(this.speed) / 0.55) * dt
    this.sync()
  }

  /** Push the simulation state into the model. */
  sync(): void {
    const parts = this.parts
    parts.root.position.set(this.x, 0, this.z)
    // A model built facing +X needs -heading about Y.
    parts.root.rotation.y = -this.heading

    const moving = Math.abs(this.speed) > 0.05
    const swing = moving ? Math.sin(this.#phase) * 0.62 : 0

    parts.legs.forEach((leg, index) => {
      leg.rotation.z = index === 0 ? swing : -swing
    })

    // A small vertical bob on each step, plus arms counter-swinging. Without
    // the bob a walk reads as a figure sliding along the pavement.
    parts.body.position.y = moving ? Math.abs(Math.sin(this.#phase)) * 0.045 : 0
    parts.arm.rotation.z = -swing * 0.7
  }

  dispose(): void {
    disposeCharacter(this.parts)
  }

  // -------------------------------------------------------------- internals

  /**
   * Push out of anything solid.
   *
   * The same treatment the car gets, minus the impact reporting: a walker
   * bumping a wall should just stop, not trigger a crash noise and a camera
   * shake.
   */
  #resolveCollisions(): void {
    const scratch = this.#obstacleScratch
    scratch.length = 0
    this.#world.obstacles.queryRadius(this.x, this.z, BODY_RADIUS + 4, scratch)

    for (const ob of scratch) {
      if (ob.r > 0) this.#resolveCircle(ob.x, ob.y, ob.r)
      else this.#resolveAabb(ob.x - ob.hw, ob.y - ob.hh, ob.x + ob.hw, ob.y + ob.hh)
    }
  }

  #resolveCircle(cx: number, cz: number, radius: number): void {
    const dx = this.x - cx
    const dz = this.z - cz
    const minimum = radius + BODY_RADIUS
    const distanceSq = dx * dx + dz * dz
    if (distanceSq >= minimum * minimum || distanceSq === 0) return

    const distance = Math.sqrt(distanceSq)
    const push = minimum - distance
    this.x += (dx / distance) * push
    this.z += (dz / distance) * push
    this.speed *= 0.4
  }

  #resolveAabb(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const nearestX = clamp(this.x, minX, maxX)
    const nearestZ = clamp(this.z, minZ, maxZ)
    let dx = this.x - nearestX
    let dz = this.z - nearestZ
    let distanceSq = dx * dx + dz * dz

    if (distanceSq >= BODY_RADIUS * BODY_RADIUS) return

    if (distanceSq === 0) {
      // Dead centre inside the box: escape via the nearest face rather than
      // dividing by zero.
      const toLeft = this.x - minX
      const toRight = maxX - this.x
      const toTop = this.z - minZ
      const toBottom = maxZ - this.z
      const least = Math.min(toLeft, toRight, toTop, toBottom)
      if (least === toLeft) dx = -1
      else if (least === toRight) dx = 1
      else if (least === toTop) dz = -1
      else dz = 1
      distanceSq = 1
    }

    const distance = Math.sqrt(distanceSq)
    const push = BODY_RADIUS - distance
    this.x += (dx / distance) * push
    this.z += (dz / distance) * push
    this.speed *= 0.4
  }
}
