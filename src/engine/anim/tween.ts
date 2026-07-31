/**
 * A small tween engine.
 *
 * Almost every piece of "juice" in the game is a tween: a button that pops
 * when pressed, a coin that arcs to the HUD, a panel that springs in. Rather
 * than scatter ad-hoc timers through gameplay code, everything animated goes
 * through this manager, which gives us one place to pause, scale, or kill all
 * animation (important for the reduced-motion setting).
 *
 * Tweens run on *real* frame time, not simulation time, because UI animation
 * should stay smooth even when the world is paused.
 */

import { type EasingFn, linear, outCubic } from './easing.js'

export interface TweenOptions<T> {
  /** Object to mutate. */
  target: T
  /** Destination values for a subset of numeric properties. */
  to: Partial<Record<NumericKeys<T>, number>>
  /** Starting values. Defaults to the target's current values. */
  from?: Partial<Record<NumericKeys<T>, number>>
  /** Seconds. */
  duration: number
  /** Seconds to wait before starting. */
  delay?: number
  ease?: EasingFn
  /** Repeat count. `Infinity` loops forever. 0 means play once. */
  repeat?: number
  /** Reverse direction on alternate repeats. */
  yoyo?: boolean
  onStart?: () => void
  onUpdate?: (progress: number) => void
  onComplete?: () => void
}

/** Keys of `T` whose value type is `number`. */
type NumericKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never
}[keyof T]

export interface TweenHandle {
  /** Stop without firing `onComplete`. */
  cancel(): void
  /** Jump to the end, apply final values, and fire `onComplete`. */
  finish(): void
  readonly isActive: boolean
}

interface TweenRecord {
  target: Record<string, number>
  keys: string[]
  fromValues: number[]
  toValues: number[]
  duration: number
  delay: number
  ease: EasingFn
  repeat: number
  yoyo: boolean
  elapsed: number
  iteration: number
  started: boolean
  done: boolean
  /** Captured lazily on start so `from` reflects the value at that moment. */
  captured: boolean
  onStart: (() => void) | undefined
  onUpdate: ((progress: number) => void) | undefined
  onComplete: (() => void) | undefined
  explicitFrom: Partial<Record<string, number>> | undefined
}

export class TweenManager {
  readonly #tweens: TweenRecord[] = []

  /**
   * Global speed multiplier. Setting this to a large number effectively
   * disables animation, which is how the reduced-motion setting is honoured
   * without special-casing every call site.
   */
  timeScale = 1

  get activeCount(): number {
    return this.#tweens.length
  }

  /** Start a tween. */
  add<T extends object>(options: TweenOptions<T>): TweenHandle {
    const target = options.target as unknown as Record<string, number>
    const keys = Object.keys(options.to) as string[]

    const record: TweenRecord = {
      target,
      keys,
      fromValues: new Array<number>(keys.length).fill(0),
      toValues: keys.map((k) => (options.to as Record<string, number>)[k] ?? 0),
      duration: Math.max(0, options.duration),
      delay: Math.max(0, options.delay ?? 0),
      ease: options.ease ?? outCubic,
      repeat: options.repeat ?? 0,
      yoyo: options.yoyo ?? false,
      elapsed: 0,
      iteration: 0,
      started: false,
      done: false,
      captured: false,
      onStart: options.onStart,
      onUpdate: options.onUpdate,
      onComplete: options.onComplete,
      explicitFrom: options.from as Partial<Record<string, number>> | undefined,
    }

    this.#tweens.push(record)
    return this.#makeHandle(record)
  }

  /**
   * Tween a single value without owning an object, e.g. driving a local
   * variable through a callback.
   */
  tweenValue(
    from: number,
    to: number,
    duration: number,
    onUpdate: (value: number) => void,
    options: { ease?: EasingFn; delay?: number; onComplete?: () => void } = {},
  ): TweenHandle {
    const holder = { value: from }
    return this.add({
      target: holder,
      to: { value: to },
      from: { value: from },
      duration,
      ...(options.delay !== undefined ? { delay: options.delay } : {}),
      ...(options.ease !== undefined ? { ease: options.ease } : {}),
      onUpdate: () => onUpdate(holder.value),
      ...(options.onComplete !== undefined ? { onComplete: options.onComplete } : {}),
    })
  }

  /** Run a callback after a delay, cancellable like any other tween. */
  delay(seconds: number, onComplete: () => void): TweenHandle {
    return this.add({
      target: { _: 0 },
      to: { _: 1 },
      duration: 0,
      delay: seconds,
      ease: linear,
      onComplete,
    })
  }

  /** Run tweens one after another. Returns a handle that cancels the whole chain. */
  sequence(steps: Array<() => TweenHandle>): TweenHandle {
    let index = 0
    let current: TweenHandle | null = null
    let cancelled = false

    const runNext = (): void => {
      if (cancelled || index >= steps.length) return
      const step = steps[index++]!
      current = step()
    }

    runNext()

    return {
      cancel: () => {
        cancelled = true
        current?.cancel()
      },
      finish: () => {
        while (!cancelled && index <= steps.length && current?.isActive) {
          current.finish()
        }
      },
      get isActive() {
        return !cancelled && index < steps.length
      },
    }
  }

  /** Advance all tweens. `dt` is real seconds. */
  update(dt: number): void {
    const scaled = dt * this.timeScale
    if (scaled <= 0) return

    // Iterate backwards so completed tweens can be spliced out in place, and
    // so callbacks that add new tweens don't get stepped in the same frame.
    for (let i = this.#tweens.length - 1; i >= 0; i--) {
      const t = this.#tweens[i]!
      this.#step(t, scaled)
      if (t.done) this.#tweens.splice(i, 1)
    }
  }

  /** Cancel every tween touching `target`, without firing callbacks. */
  cancelTarget(target: object): void {
    for (let i = this.#tweens.length - 1; i >= 0; i--) {
      if (this.#tweens[i]!.target === (target as unknown as Record<string, number>)) {
        this.#tweens.splice(i, 1)
      }
    }
  }

  /** Cancel everything. Called on scene teardown. */
  clear(): void {
    this.#tweens.length = 0
  }

  #step(t: TweenRecord, dt: number): void {
    if (t.done) return

    if (t.delay > 0) {
      t.delay -= dt
      if (t.delay > 0) return
      // Roll the leftover into this frame so delays don't quantise to frames.
      dt = -t.delay
      t.delay = 0
    }

    if (!t.started) {
      t.started = true
      t.onStart?.()
    }

    if (!t.captured) {
      t.captured = true
      for (let k = 0; k < t.keys.length; k++) {
        const key = t.keys[k]!
        const explicit = t.explicitFrom?.[key]
        t.fromValues[k] = explicit ?? t.target[key] ?? 0
      }
    }

    t.elapsed += dt

    // A zero-duration tween is a one-frame snap to the destination.
    let progress = t.duration <= 0 ? 1 : t.elapsed / t.duration
    let finished = false

    if (progress >= 1) {
      if (t.iteration < t.repeat) {
        t.iteration++
        t.elapsed = t.duration <= 0 ? 0 : t.elapsed % t.duration
        progress = t.duration <= 0 ? 1 : t.elapsed / t.duration
      } else {
        progress = 1
        finished = true
      }
    }

    // On a yoyo, odd iterations play backwards.
    const directed = t.yoyo && t.iteration % 2 === 1 ? 1 - progress : progress
    const eased = t.ease(directed)

    for (let k = 0; k < t.keys.length; k++) {
      const from = t.fromValues[k]!
      const to = t.toValues[k]!
      t.target[t.keys[k]!] = from + (to - from) * eased
    }

    t.onUpdate?.(progress)

    if (finished) {
      t.done = true
      t.onComplete?.()
    }
  }

  #makeHandle(record: TweenRecord): TweenHandle {
    const remove = (): void => {
      const index = this.#tweens.indexOf(record)
      if (index >= 0) this.#tweens.splice(index, 1)
    }

    return {
      cancel: () => {
        if (record.done) return
        record.done = true
        remove()
      },
      finish: () => {
        if (record.done) return
        // Ensure `from` is captured even if the tween never started.
        if (!record.captured) {
          record.captured = true
          for (let k = 0; k < record.keys.length; k++) {
            const key = record.keys[k]!
            record.fromValues[k] = record.explicitFrom?.[key] ?? record.target[key] ?? 0
          }
        }
        for (let k = 0; k < record.keys.length; k++) {
          record.target[record.keys[k]!] = record.toValues[k]!
        }
        record.done = true
        remove()
        record.onComplete?.()
      },
      get isActive() {
        return !record.done
      },
    }
  }
}

/**
 * A self-contained spring value, for cases where a tween's fixed duration is
 * the wrong model — a HUD number chasing a moving target, or a button scale
 * that should react to a new press mid-animation.
 */
export class SpringValue {
  value: number
  target: number
  #velocity = 0

  constructor(
    initial = 0,
    /** Roughly the time in seconds to settle. */
    public smoothTime = 0.25,
  ) {
    this.value = initial
    this.target = initial
  }

  /** Jump to a value, killing momentum. */
  snap(value: number): void {
    this.value = value
    this.target = value
    this.#velocity = 0
  }

  /** Kick the spring, e.g. a button scale punch. */
  impulse(amount: number): void {
    this.#velocity += amount
  }

  update(dt: number): number {
    const omega = 2 / Math.max(0.0001, this.smoothTime)
    const x = omega * dt
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const change = this.value - this.target
    const temp = (this.#velocity + omega * change) * dt
    this.#velocity = (this.#velocity - omega * temp) * exp
    this.value = this.target + (change + temp) * exp
    return this.value
  }

  get velocity(): number {
    return this.#velocity
  }

  get isSettled(): boolean {
    return Math.abs(this.value - this.target) < 0.001 && Math.abs(this.#velocity) < 0.001
  }
}
