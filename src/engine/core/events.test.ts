import { describe, expect, it, vi } from 'vitest'

import { EventBus, SubscriptionBag } from './events.js'

interface TestEvents extends Record<string, unknown> {
  ping: { value: number }
  pong: { text: string }
}

describe('EventBus', () => {
  it('delivers payloads to subscribers', () => {
    const bus = new EventBus<TestEvents>()
    const seen: number[] = []
    bus.on('ping', (p) => seen.push(p.value))

    bus.emit('ping', { value: 1 })
    bus.emit('ping', { value: 2 })

    expect(seen).toEqual([1, 2])
  })

  it('delivers in subscription order', () => {
    const bus = new EventBus<TestEvents>()
    const order: string[] = []
    bus.on('ping', () => order.push('first'))
    bus.on('ping', () => order.push('second'))

    bus.emit('ping', { value: 0 })
    expect(order).toEqual(['first', 'second'])
  })

  it('does not cross-deliver between event types', () => {
    const bus = new EventBus<TestEvents>()
    const fn = vi.fn()
    bus.on('pong', fn)
    bus.emit('ping', { value: 1 })
    expect(fn).not.toHaveBeenCalled()
  })

  it('emitting with no subscribers is a no-op', () => {
    const bus = new EventBus<TestEvents>()
    expect(() => bus.emit('ping', { value: 1 })).not.toThrow()
  })

  it('unsubscribes via the returned handle', () => {
    const bus = new EventBus<TestEvents>()
    const fn = vi.fn()
    const sub = bus.on('ping', fn)

    bus.emit('ping', { value: 1 })
    sub.unsubscribe()
    bus.emit('ping', { value: 2 })

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('tolerates double unsubscribe', () => {
    const bus = new EventBus<TestEvents>()
    const sub = bus.on('ping', () => {})
    sub.unsubscribe()
    expect(() => sub.unsubscribe()).not.toThrow()
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('fires a once listener exactly once', () => {
    const bus = new EventBus<TestEvents>()
    const fn = vi.fn()
    bus.once('ping', fn)

    bus.emit('ping', { value: 1 })
    bus.emit('ping', { value: 2 })

    expect(fn).toHaveBeenCalledTimes(1)
    expect(bus.listenerCount('ping')).toBe(0)
  })

  it('lets a listener unsubscribe itself mid-dispatch', () => {
    const bus = new EventBus<TestEvents>()
    const calls: string[] = []

    const sub = bus.on('ping', () => {
      calls.push('self')
      sub.unsubscribe()
    })
    bus.on('ping', () => calls.push('other'))

    bus.emit('ping', { value: 1 })
    bus.emit('ping', { value: 2 })

    // 'other' still runs in the first dispatch even though 'self' removed
    // itself partway through — the classic array-mutation bug.
    expect(calls).toEqual(['self', 'other', 'other'])
  })

  it('skips a listener removed by an earlier listener in the same dispatch', () => {
    const bus = new EventBus<TestEvents>()
    const second = vi.fn()

    let sub2: { unsubscribe(): void }
    bus.on('ping', () => sub2.unsubscribe())
    sub2 = bus.on('ping', second)

    bus.emit('ping', { value: 1 })
    expect(second).not.toHaveBeenCalled()
  })

  it('does not deliver to listeners added during the same dispatch', () => {
    const bus = new EventBus<TestEvents>()
    const late = vi.fn()

    bus.on('ping', () => {
      bus.on('ping', late)
    })

    bus.emit('ping', { value: 1 })
    expect(late).not.toHaveBeenCalled()

    // But it does receive the next one.
    bus.emit('ping', { value: 2 })
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('supports nested emits', () => {
    const bus = new EventBus<TestEvents>()
    const seen: string[] = []

    bus.on('ping', () => {
      seen.push('ping')
      bus.emit('pong', { text: 'inner' })
    })
    bus.on('pong', (p) => seen.push(`pong:${p.text}`))

    bus.emit('ping', { value: 1 })
    expect(seen).toEqual(['ping', 'pong:inner'])
  })

  it('removes a specific listener with off()', () => {
    const bus = new EventBus<TestEvents>()
    const a = vi.fn()
    const b = vi.fn()
    bus.on('ping', a)
    bus.on('ping', b)

    bus.off('ping', a)
    bus.emit('ping', { value: 1 })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('clears one type or everything', () => {
    const bus = new EventBus<TestEvents>()
    bus.on('ping', () => {})
    bus.on('pong', () => {})

    bus.clear('ping')
    expect(bus.listenerCount('ping')).toBe(0)
    expect(bus.listenerCount('pong')).toBe(1)

    bus.clear()
    expect(bus.listenerCount('pong')).toBe(0)
  })

  it('reports an accurate listener count after removals', () => {
    const bus = new EventBus<TestEvents>()
    const s1 = bus.on('ping', () => {})
    bus.on('ping', () => {})
    expect(bus.listenerCount('ping')).toBe(2)

    s1.unsubscribe()
    expect(bus.listenerCount('ping')).toBe(1)
  })
})

describe('SubscriptionBag', () => {
  it('disposes every tracked subscription at once', () => {
    const bus = new EventBus<TestEvents>()
    const bag = new SubscriptionBag()
    const a = vi.fn()
    const b = vi.fn()

    bag.on(bus, 'ping', a)
    bag.on(bus, 'pong', b)

    bus.emit('ping', { value: 1 })
    bus.emit('pong', { text: 'x' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    bag.dispose()

    bus.emit('ping', { value: 2 })
    bus.emit('pong', { text: 'y' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('is safe to dispose twice', () => {
    const bus = new EventBus<TestEvents>()
    const bag = new SubscriptionBag()
    bag.on(bus, 'ping', () => {})
    bag.dispose()
    expect(() => bag.dispose()).not.toThrow()
  })
})
