/**
 * The chase camera.
 *
 * Third person rather than first person, deliberately. A 6-year-old needs to
 * see the car they own — it is the thing they are proud of and the thing
 * they are about to upgrade — and a cockpit view removes it entirely. Third
 * person also gives far better spatial awareness for judging turns, which
 * matters a lot when your motor control is still developing.
 *
 * The rig is a spring-damped follow with these behaviours:
 * - Sits behind and above the car, looking slightly down at it.
 * - Yaw follows the car's heading, but *lazily*, so a quick turn swings the
 *   world around rather than snapping the camera rigidly.
 * - Pulls back and lifts with speed, which reads as "going fast" without
 *   changing the field of view (FOV changes are a common nausea trigger).
 * - Shake is brief, gentle, and fully disabled under reduced motion.
 */

import { PerspectiveCamera, Vector3 } from 'three'

import { clamp, damp, dampAngle, lerp } from '../math/scalar.js'
import { cosmeticRng } from '../math/rng.js'

export interface ChaseCameraOptions {
  /** Distance behind the target at rest. */
  distance?: number
  /** Height above the target at rest. */
  height?: number
  /** Extra distance at full speed. */
  distanceAtSpeed?: number
  /** Extra height at full speed. */
  heightAtSpeed?: number
  /** How high above the target's origin the camera aims. */
  lookHeight?: number
  /** Seconds for position to converge. Higher = laggier, weightier. */
  positionSmoothing?: number
  /** Seconds for yaw to converge. Deliberately slower than position. */
  yawSmoothing?: number
}

interface ShakeState {
  time: number
  duration: number
  magnitude: number
  frequency: number
  phaseX: number
  phaseY: number
}

export class ChaseCamera {
  readonly camera: PerspectiveCamera

  /** Global shake multiplier; the settings layer zeroes this for reduced motion. */
  shakeScale = 1

  readonly #opts: Required<ChaseCameraOptions>

  /** Smoothed yaw the rig orbits at, radians. */
  #yaw = 0
  /** Smoothed follow point, so the camera lags the car rather than sticking to it. */
  readonly #anchor = new Vector3()
  /** Smoothed 0..1 speed, driving distance and height. */
  #speedT = 0

  readonly #shakes: ShakeState[] = []
  readonly #shakeOffset = new Vector3()

  /** Scratch vectors — the rig runs every frame and must not allocate. */
  readonly #desired = new Vector3()
  readonly #lookAt = new Vector3()

  #initialised = false

  constructor(camera: PerspectiveCamera, options: ChaseCameraOptions = {}) {
    this.camera = camera
    this.#opts = {
      distance: options.distance ?? 9.5,
      height: options.height ?? 4.6,
      distanceAtSpeed: options.distanceAtSpeed ?? 3.4,
      heightAtSpeed: options.heightAtSpeed ?? 1.1,
      lookHeight: options.lookHeight ?? 1.5,
      positionSmoothing: options.positionSmoothing ?? 0.13,
      yawSmoothing: options.yawSmoothing ?? 0.22,
    }
  }

  /** Place the camera immediately, cancelling all smoothing. Use on scene entry. */
  snapTo(targetX: number, targetY: number, targetZ: number, heading: number): void {
    this.#yaw = heading
    this.#anchor.set(targetX, targetY, targetZ)
    this.#speedT = 0
    this.#shakes.length = 0
    this.#initialised = true
    this.#apply(0)
  }

  /**
   * Follow a target.
   *
   * @param heading the car's heading in radians, where 0 faces +X. The camera
   *   sits opposite this.
   * @param speedFraction 0..1 of top speed.
   */
  follow(
    targetX: number,
    targetY: number,
    targetZ: number,
    heading: number,
    speedFraction: number,
    dt: number,
  ): void {
    if (!this.#initialised) {
      this.snapTo(targetX, targetY, targetZ, heading)
      return
    }

    // Anchor lags the car slightly; this is what gives motion its weight.
    this.#anchor.x = damp(this.#anchor.x, targetX, 0.0005, dt)
    this.#anchor.y = damp(this.#anchor.y, targetY, 0.0005, dt)
    this.#anchor.z = damp(this.#anchor.z, targetZ, 0.0005, dt)

    // Yaw takes the short way around, so crossing due-west doesn't spin the
    // whole world through 350 degrees.
    this.#yaw = dampAngle(this.#yaw, heading, this.#opts.yawSmoothing * 0.02, dt)

    this.#speedT = damp(this.#speedT, clamp(speedFraction, 0, 1), 0.02, dt)

    this.#apply(dt)
  }

  /**
   * Shake the camera.
   *
   * @param magnitude world units of peak offset. Keep small — over ~0.35 this
   *   stops reading as impact and starts reading as a fault.
   */
  shake(magnitude: number, duration = 0.28, frequency = 20): void {
    if (this.shakeScale <= 0 || magnitude <= 0) return
    this.#shakes.push({
      time: duration,
      duration,
      magnitude,
      frequency,
      phaseX: cosmeticRng.range(0, Math.PI * 2),
      phaseY: cosmeticRng.range(0, Math.PI * 2),
    })
  }

  /** The direction the camera is facing on the ground plane, for input mapping. */
  get yaw(): number {
    return this.#yaw
  }

  #apply(dt: number): void {
    this.#updateShake(dt)

    const distance = this.#opts.distance + this.#opts.distanceAtSpeed * this.#speedT
    const height = this.#opts.height + this.#opts.heightAtSpeed * this.#speedT

    // Sit behind the car: opposite its heading, on the XZ plane.
    // Heading 0 faces +X, so "behind" is -X rotated by yaw.
    const behindX = -Math.cos(this.#yaw) * distance
    const behindZ = -Math.sin(this.#yaw) * distance

    this.#desired.set(
      this.#anchor.x + behindX + this.#shakeOffset.x,
      this.#anchor.y + height + this.#shakeOffset.y,
      this.#anchor.z + behindZ + this.#shakeOffset.z,
    )

    if (dt > 0) {
      this.camera.position.x = damp(this.camera.position.x, this.#desired.x, 0.0001, dt)
      this.camera.position.y = damp(this.camera.position.y, this.#desired.y, 0.0001, dt)
      this.camera.position.z = damp(this.camera.position.z, this.#desired.z, 0.0001, dt)
    } else {
      this.camera.position.copy(this.#desired)
    }

    // Look slightly ahead of the car as well as at it, so more road is
    // visible at speed without moving the car off-centre.
    const leadDistance = lerp(0, 4.5, this.#speedT)
    this.#lookAt.set(
      this.#anchor.x + Math.cos(this.#yaw) * leadDistance + this.#shakeOffset.x,
      this.#anchor.y + this.#opts.lookHeight + this.#shakeOffset.y,
      this.#anchor.z + Math.sin(this.#yaw) * leadDistance + this.#shakeOffset.z,
    )
    this.camera.lookAt(this.#lookAt)
  }

  #updateShake(dt: number): void {
    this.#shakeOffset.set(0, 0, 0)
    if (dt <= 0) return

    for (let i = this.#shakes.length - 1; i >= 0; i--) {
      const s = this.#shakes[i]!
      s.time -= dt
      if (s.time <= 0) {
        this.#shakes.splice(i, 1)
        continue
      }

      // Quadratic decay: a soft tail rather than an abrupt stop.
      const t = s.time / s.duration
      const decay = t * t
      const elapsed = s.duration - s.time
      const angle = elapsed * s.frequency * Math.PI * 2
      const amount = s.magnitude * decay * this.shakeScale

      this.#shakeOffset.x += Math.sin(angle + s.phaseX) * amount
      this.#shakeOffset.y += Math.cos(angle * 0.9 + s.phaseY) * amount * 0.6
    }
  }
}

