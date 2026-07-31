import { describe, expect, it, vi } from 'vitest'

import { SpringValue, TweenManager } from './tween.js'
import { linear, outBack, outElastic } from './easing.js'

/** Advance a manager in fixed steps, as the real loop does. */
function run(manager: TweenManager, seconds: number, step = 1 / 60): void {
  const steps = Math.round(seconds / step)
  for (let i = 0; i < steps; i++) manager.update(step)
}

describe('TweenManager', () => {
  it('interpolates a property to its target', () => {
    const manager = new TweenManager()
    const target = { x: 0 }

    manager.add({ target, to: { x: 100 }, duration: 1, ease: linear })
    run(manager, 0.5)

    expect(target.x).toBeGreaterThan(40)
    expect(target.x).toBeLessThan(60)

    run(manager, 0.6)
    expect(target.x).toBe(100)
  })

  it('lands exactly on the target value', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    manager.add({ target, to: { x: 42 }, duration: 0.5, ease: linear })
    run(manager, 1)
    // Floating-point drift here shows up as a UI element that never quite
    // settles at its final position.
    expect(target.x).toBe(42)
  })

  it('tweens several properties at once', () => {
    const manager = new TweenManager()
    const target = { x: 0, y: 0, scale: 1 }

    manager.add({ target, to: { x: 10, y: 20, scale: 2 }, duration: 0.5, ease: linear })
    run(manager, 1)

    expect(target).toEqual({ x: 10, y: 20, scale: 2 })
  })

  it('honours an explicit from value', () => {
    const manager = new TweenManager()
    const target = { x: 999 }
    manager.add({ target, from: { x: 0 }, to: { x: 100 }, duration: 1, ease: linear })

    // After one tick the value must have snapped down near `from`, proving the
    // tween ignored the property's pre-existing 999.
    manager.update(1 / 60)
    expect(target.x).toBeGreaterThanOrEqual(0)
    expect(target.x).toBeLessThan(5)

    run(manager, 1.1)
    expect(target.x).toBe(100)
  })

  it('captures the start value lazily, after any delay', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    manager.add({ target, to: { x: 100 }, duration: 1, delay: 0.5, ease: linear })

    // Something else moves the value during the delay.
    run(manager, 0.25)
    expect(target.x).toBe(0)
    target.x = 50

    run(manager, 0.35) // delay elapses
    // Should now be tweening from 50, not from the original 0.
    expect(target.x).toBeGreaterThan(50)
  })

  it('does not start before its delay elapses', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    const onStart = vi.fn()

    manager.add({ target, to: { x: 100 }, duration: 0.5, delay: 1, ease: linear, onStart })

    run(manager, 0.9)
    expect(onStart).not.toHaveBeenCalled()
    expect(target.x).toBe(0)

    run(manager, 0.2)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('fires onComplete exactly once', () => {
    const manager = new TweenManager()
    const onComplete = vi.fn()
    manager.add({ target: { x: 0 }, to: { x: 1 }, duration: 0.2, onComplete })

    run(manager, 1)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('removes finished tweens', () => {
    const manager = new TweenManager()
    manager.add({ target: { x: 0 }, to: { x: 1 }, duration: 0.1 })
    expect(manager.activeCount).toBe(1)

    run(manager, 0.5)
    expect(manager.activeCount).toBe(0)
  })

  it('repeats the requested number of extra times', () => {
    const manager = new TweenManager()
    const onComplete = vi.fn()
    const target = { x: 0 }

    manager.add({ target, to: { x: 1 }, duration: 0.1, repeat: 2, ease: linear, onComplete })

    run(manager, 0.05)
    expect(onComplete).not.toHaveBeenCalled()

    // Three passes total (initial + 2 repeats) = 0.3s.
    run(manager, 0.4)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(manager.activeCount).toBe(0)
  })

  it('reverses direction on yoyo repeats', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    manager.add({ target, to: { x: 100 }, duration: 0.2, repeat: 1, yoyo: true, ease: linear })

    run(manager, 0.2)
    // End of the forward pass.
    expect(target.x).toBeGreaterThan(90)

    run(manager, 0.19)
    // Back near the start after the reverse pass.
    expect(target.x).toBeLessThan(20)
  })

  it('cancel stops the tween without firing onComplete', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    const onComplete = vi.fn()

    const handle = manager.add({ target, to: { x: 100 }, duration: 1, onComplete })
    run(manager, 0.2)
    handle.cancel()
    const valueAtCancel = target.x

    run(manager, 2)
    expect(onComplete).not.toHaveBeenCalled()
    expect(target.x).toBe(valueAtCancel)
    expect(handle.isActive).toBe(false)
  })

  it('finish jumps to the end and fires onComplete', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    const onComplete = vi.fn()

    const handle = manager.add({ target, to: { x: 100 }, duration: 5, onComplete })
    handle.finish()

    expect(target.x).toBe(100)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(manager.activeCount).toBe(0)
  })

  it('finish works even before the tween has started ticking', () => {
    const manager = new TweenManager()
    const target = { x: 7 }
    const handle = manager.add({ target, to: { x: 100 }, duration: 5, delay: 10 })
    handle.finish()
    expect(target.x).toBe(100)
  })

  it('cancelling twice is harmless', () => {
    const manager = new TweenManager()
    const handle = manager.add({ target: { x: 0 }, to: { x: 1 }, duration: 1 })
    handle.cancel()
    expect(() => handle.cancel()).not.toThrow()
  })

  it('cancelTarget removes every tween on an object', () => {
    const manager = new TweenManager()
    const target = { x: 0, y: 0 }

    manager.add({ target, to: { x: 100 }, duration: 1 })
    manager.add({ target, to: { y: 100 }, duration: 1 })
    manager.add({ target: { z: 0 }, to: { z: 1 }, duration: 1 })
    expect(manager.activeCount).toBe(3)

    manager.cancelTarget(target)
    expect(manager.activeCount).toBe(1)
  })

  it('handles a zero-duration tween as an immediate snap', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    const onComplete = vi.fn()

    manager.add({ target, to: { x: 100 }, duration: 0, onComplete })
    manager.update(1 / 60)

    expect(target.x).toBe(100)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('delay() runs a callback after the given time', () => {
    const manager = new TweenManager()
    const fn = vi.fn()
    manager.delay(0.5, fn)

    run(manager, 0.4)
    expect(fn).not.toHaveBeenCalled()

    run(manager, 0.2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('tweenValue reports intermediate values', () => {
    const manager = new TweenManager()
    const seen: number[] = []
    manager.tweenValue(0, 10, 0.2, (v) => seen.push(v), { ease: linear })

    run(manager, 0.3)
    expect(seen.length).toBeGreaterThan(3)
    expect(seen[seen.length - 1]).toBe(10)
  })

  it('timeScale of zero freezes animation', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    manager.timeScale = 0
    manager.add({ target, to: { x: 100 }, duration: 0.1 })

    run(manager, 1)
    expect(target.x).toBe(0)
  })

  it('a large timeScale effectively completes animation instantly', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    manager.timeScale = 1000
    manager.add({ target, to: { x: 100 }, duration: 1 })

    manager.update(1 / 60)
    expect(target.x).toBe(100)
  })

  it('clear removes everything without firing callbacks', () => {
    const manager = new TweenManager()
    const onComplete = vi.fn()
    manager.add({ target: { x: 0 }, to: { x: 1 }, duration: 1, onComplete })

    manager.clear()
    expect(manager.activeCount).toBe(0)
    run(manager, 2)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('overshoots with back easing then settles exactly', () => {
    const manager = new TweenManager()
    const target = { scale: 0 }
    let peak = 0

    manager.add({
      target,
      to: { scale: 1 },
      duration: 0.4,
      ease: outBack,
      onUpdate: () => {
        peak = Math.max(peak, target.scale)
      },
    })

    run(manager, 0.6)
    // The overshoot is the point of outBack — it should exceed the target...
    expect(peak).toBeGreaterThan(1)
    // ...but still land precisely.
    expect(target.scale).toBe(1)
  })

  it('elastic easing also lands exactly on target', () => {
    const manager = new TweenManager()
    const target = { x: 0 }
    manager.add({ target, to: { x: 50 }, duration: 0.5, ease: outElastic })
    run(manager, 1)
    expect(target.x).toBe(50)
  })

  it('tolerates a tween added from inside another tween callback', () => {
    const manager = new TweenManager()
    const target = { x: 0, y: 0 }

    manager.add({
      target,
      to: { x: 1 },
      duration: 0.1,
      onComplete: () => {
        manager.add({ target, to: { y: 1 }, duration: 0.1 })
      },
    })

    expect(() => run(manager, 0.5)).not.toThrow()
    expect(target.y).toBe(1)
  })
})

describe('SpringValue', () => {
  it('converges on its target', () => {
    const spring = new SpringValue(0, 0.2)
    spring.target = 100

    for (let i = 0; i < 240; i++) spring.update(1 / 60)

    expect(spring.value).toBeCloseTo(100, 1)
    expect(spring.isSettled).toBe(true)
  })

  it('snap jumps instantly and kills momentum', () => {
    const spring = new SpringValue(0, 0.2)
    spring.target = 100
    for (let i = 0; i < 10; i++) spring.update(1 / 60)

    spring.snap(5)
    expect(spring.value).toBe(5)
    expect(spring.target).toBe(5)
    expect(spring.velocity).toBe(0)
  })

  it('an impulse moves the value away before it returns', () => {
    const spring = new SpringValue(1, 0.2)
    spring.target = 1
    spring.impulse(-20)

    spring.update(1 / 60)
    // The kick should push it off the target...
    expect(spring.value).not.toBeCloseTo(1, 3)

    for (let i = 0; i < 240; i++) spring.update(1 / 60)
    // ...and it should come back.
    expect(spring.value).toBeCloseTo(1, 2)
  })

  it('tracks a moving target', () => {
    const spring = new SpringValue(0, 0.1)
    for (let i = 0; i < 300; i++) {
      spring.target = i
      spring.update(1 / 60)
    }
    // It lags slightly but stays close.
    expect(Math.abs(spring.value - 299)).toBeLessThan(15)
  })
})
