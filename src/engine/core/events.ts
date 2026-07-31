/**
 * A tiny typed event bus.
 *
 * Systems talk to each other through this rather than holding direct
 * references, which is what keeps gameplay, audio, UI, and juice decoupled:
 * "a passenger was picked up" is emitted once and independently consumed by
 * the score system, the sound system, the particle system, and the tutorial.
 *
 * Events are delivered synchronously, in subscription order.
 */

export type EventMap = Record<string, unknown>

export type Listener<T> = (payload: T) => void

export interface Subscription {
  /** Remove this listener. Safe to call more than once. */
  unsubscribe(): void
}

interface ListenerRecord {
  fn: Listener<never>
  once: boolean
  /** Set when removed during a dispatch, so we can skip it safely. */
  removed: boolean
}

export class EventBus<Events extends EventMap> {
  readonly #listeners = new Map<keyof Events, ListenerRecord[]>()

  /** Depth of nested `emit` calls, so we only compact arrays at the top level. */
  #dispatchDepth = 0
  #needsCompaction = false

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): Subscription {
    return this.#add(type, fn as Listener<never>, false)
  }

  /** Subscribe for a single delivery, then auto-unsubscribe. */
  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): Subscription {
    return this.#add(type, fn as Listener<never>, true)
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    const records = this.#listeners.get(type)
    if (!records) return
    for (const record of records) {
      if (record.fn === (fn as Listener<never>) && !record.removed) {
        record.removed = true
        this.#scheduleCompaction()
        return
      }
    }
  }

  /**
   * Deliver an event to every current listener.
   *
   * Listeners added *during* this dispatch are not called by it; listeners
   * removed during it are skipped. That makes it safe for a handler to
   * unsubscribe itself or spawn new subscriptions.
   */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const records = this.#listeners.get(type)
    if (!records || records.length === 0) return

    this.#dispatchDepth++
    // Snapshot the length so listeners appended during dispatch are skipped.
    const count = records.length
    try {
      for (let i = 0; i < count; i++) {
        const record = records[i]
        if (!record || record.removed) continue
        if (record.once) {
          record.removed = true
          this.#needsCompaction = true
        }
        ;(record.fn as Listener<Events[K]>)(payload)
      }
    } finally {
      this.#dispatchDepth--
      if (this.#dispatchDepth === 0 && this.#needsCompaction) {
        this.#compact()
      }
    }
  }

  /** Remove every listener for one event type, or for all types. */
  clear<K extends keyof Events>(type?: K): void {
    if (type === undefined) {
      if (this.#dispatchDepth > 0) {
        for (const records of this.#listeners.values()) {
          for (const record of records) record.removed = true
        }
        this.#scheduleCompaction()
      } else {
        this.#listeners.clear()
      }
      return
    }

    if (this.#dispatchDepth > 0) {
      const records = this.#listeners.get(type)
      if (records) {
        for (const record of records) record.removed = true
        this.#scheduleCompaction()
      }
    } else {
      this.#listeners.delete(type)
    }
  }

  listenerCount<K extends keyof Events>(type: K): number {
    const records = this.#listeners.get(type)
    if (!records) return 0
    let n = 0
    for (const record of records) if (!record.removed) n++
    return n
  }

  #add<K extends keyof Events>(
    type: K,
    fn: Listener<never>,
    once: boolean,
  ): Subscription {
    let records = this.#listeners.get(type)
    if (!records) {
      records = []
      this.#listeners.set(type, records)
    }

    const record: ListenerRecord = { fn, once, removed: false }
    records.push(record)

    let unsubscribed = false
    return {
      unsubscribe: () => {
        if (unsubscribed || record.removed) return
        unsubscribed = true
        record.removed = true
        this.#scheduleCompaction()
      },
    }
  }

  #scheduleCompaction(): void {
    this.#needsCompaction = true
    if (this.#dispatchDepth === 0) this.#compact()
  }

  #compact(): void {
    this.#needsCompaction = false
    for (const [type, records] of this.#listeners) {
      const kept = records.filter((r) => !r.removed)
      if (kept.length === 0) this.#listeners.delete(type)
      else if (kept.length !== records.length) this.#listeners.set(type, kept)
    }
  }
}

/**
 * Collects subscriptions so a scene can tear all of them down in one call.
 * Every scene owns one of these; forgetting to unsubscribe is the classic
 * source of zombie listeners firing against a destroyed scene.
 */
export class SubscriptionBag {
  readonly #subs: Subscription[] = []

  add(sub: Subscription): Subscription {
    this.#subs.push(sub)
    return sub
  }

  /** Convenience: subscribe and track in one call. */
  on<Events extends EventMap, K extends keyof Events>(
    bus: EventBus<Events>,
    type: K,
    fn: Listener<Events[K]>,
  ): Subscription {
    return this.add(bus.on(type, fn))
  }

  dispose(): void {
    for (const sub of this.#subs) sub.unsubscribe()
    this.#subs.length = 0
  }
}
