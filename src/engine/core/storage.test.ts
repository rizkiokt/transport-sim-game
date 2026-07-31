import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SaveStore } from './storage.js'

/** Minimal in-memory localStorage, with hooks to simulate failure modes. */
class MockStorage {
  #data = new Map<string, string>()
  /** When set, setItem throws — simulating a quota-exceeded browser. */
  failWrites = false
  /** When set, getItem throws — simulating locked-down privacy settings. */
  failReads = false

  getItem(key: string): string | null {
    if (this.failReads) throw new DOMException('read blocked', 'SecurityError')
    return this.#data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('quota exceeded', 'QuotaExceededError')
    this.#data.set(key, value)
  }

  removeItem(key: string): void {
    this.#data.delete(key)
  }

  clear(): void {
    this.#data.clear()
  }

  get raw(): Map<string, string> {
    return this.#data
  }
}

interface SaveV3 {
  coins: number
  vehicleId: string
  upgrades: Record<string, number>
}

let storage: MockStorage

beforeEach(() => {
  storage = new MockStorage()
  vi.stubGlobal('localStorage', storage)
  // The store registers unload listeners; give it a no-op window.
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('document', { hidden: false })
})

function makeStore(overrides: Partial<Parameters<typeof createOptions>[0]> = {}) {
  return new SaveStore<SaveV3>(createOptions(overrides))
}

function createOptions(overrides: Record<string, unknown> = {}) {
  return {
    key: 'test-save',
    version: 3,
    createDefault: (): SaveV3 => ({ coins: 0, vehicleId: 'taxi', upgrades: {} }),
    migrations: {
      // v1 stored money as `cash`; v2 renamed it to `coins`.
      1: (data: unknown) => {
        const d = data as { cash?: number; vehicleId?: string }
        return { coins: d.cash ?? 0, vehicleId: d.vehicleId ?? 'taxi' }
      },
      // v2 had no upgrades map.
      2: (data: unknown) => ({ ...(data as object), upgrades: {} }),
    },
    validate: (data: unknown): boolean => {
      const d = data as SaveV3
      return typeof d?.coins === 'number' && typeof d?.vehicleId === 'string'
    },
    writeDebounceMs: 0,
    ...overrides,
  } as const
}

describe('SaveStore', () => {
  it('returns a fresh save when nothing is stored', () => {
    const store = makeStore()
    const result = store.load()

    expect(result.outcome).toBe('fresh')
    expect(result.data).toEqual({ coins: 0, vehicleId: 'taxi', upgrades: {} })
  })

  it('round-trips a save', () => {
    const store = makeStore()
    store.save({ coins: 250, vehicleId: 'van', upgrades: { speed: 2 } })
    store.flush()

    const reloaded = makeStore().load()
    expect(reloaded.outcome).toBe('loaded')
    expect(reloaded.data).toEqual({ coins: 250, vehicleId: 'van', upgrades: { speed: 2 } })
  })

  it('coalesces repeated saves into one write', () => {
    const store = new SaveStore<SaveV3>(createOptions({ writeDebounceMs: 50 }))
    const spy = vi.spyOn(storage, 'setItem')

    store.save({ coins: 1, vehicleId: 'taxi', upgrades: {} })
    store.save({ coins: 2, vehicleId: 'taxi', upgrades: {} })
    store.save({ coins: 3, vehicleId: 'taxi', upgrades: {} })
    expect(spy).not.toHaveBeenCalled()

    store.flush()
    // Only the newest value is written.
    expect(makeStore().load().data.coins).toBe(3)
  })

  it('migrates a v1 save all the way forward', () => {
    storage.setItem(
      'test-save',
      JSON.stringify({ version: 1, savedAt: 0, data: { cash: 500, vehicleId: 'limo' } }),
    )

    const result = makeStore().load()
    expect(result.outcome).toBe('migrated')
    expect(result.data).toEqual({ coins: 500, vehicleId: 'limo', upgrades: {} })
  })

  it('migrates a v2 save through the remaining step', () => {
    storage.setItem(
      'test-save',
      JSON.stringify({ version: 2, savedAt: 0, data: { coins: 99, vehicleId: 'bus' } }),
    )

    const result = makeStore().load()
    expect(result.outcome).toBe('migrated')
    expect(result.data.upgrades).toEqual({})
    expect(result.data.coins).toBe(99)
  })

  it('starts fresh when a migration step is missing', () => {
    storage.setItem('test-save', JSON.stringify({ version: 0, savedAt: 0, data: {} }))

    const result = makeStore().load()
    expect(result.outcome).toBe('fresh')
    expect(result.note).toContain('no migration')
  })

  it('refuses a save from a newer build rather than mangling it', () => {
    storage.setItem(
      'test-save',
      JSON.stringify({ version: 99, savedAt: 0, data: { coins: 1 } }),
    )

    const result = makeStore().load()
    expect(result.outcome).toBe('fresh')
    expect(result.note).toContain('newer version')
  })

  it('starts fresh on unparseable JSON', () => {
    storage.setItem('test-save', 'not json at all{{{')

    const result = makeStore().load()
    expect(result.outcome).toBe('fresh')
    expect(result.note).toContain('valid JSON')
  })

  it('starts fresh on a malformed envelope', () => {
    storage.setItem('test-save', JSON.stringify({ nope: true }))

    const result = makeStore().load()
    expect(result.outcome).toBe('fresh')
    expect(result.note).toContain('malformed')
  })

  it('rejects data that fails validation', () => {
    storage.setItem(
      'test-save',
      JSON.stringify({ version: 3, savedAt: 0, data: { coins: 'lots' } }),
    )

    const result = makeStore().load()
    expect(result.outcome).toBe('fresh')
    expect(result.note).toContain('validation')
  })

  it('starts fresh when a migration throws', () => {
    const store = new SaveStore<SaveV3>(
      createOptions({
        migrations: {
          1: () => {
            throw new Error('boom')
          },
          2: (d: unknown) => d,
        },
      }),
    )
    storage.setItem('test-save', JSON.stringify({ version: 1, savedAt: 0, data: {} }))

    const result = store.load()
    expect(result.outcome).toBe('fresh')
    expect(result.note).toContain('migration from 1 failed')
  })

  it('recovers from the backup when the primary save is corrupt', () => {
    // Write a good save, then a second one — which rolls the first to backup.
    const store = makeStore()
    store.save({ coins: 100, vehicleId: 'taxi', upgrades: {} })
    store.flush()
    store.save({ coins: 200, vehicleId: 'van', upgrades: {} })
    store.flush()

    // Corrupt only the primary.
    storage.setItem('test-save', 'corrupted!!!')

    const result = makeStore().load()
    expect(result.outcome).toBe('recovered')
    expect(result.data.coins).toBe(100)
  })

  it('keeps the game running when storage is entirely unavailable', () => {
    storage.failReads = true
    storage.failWrites = true

    const store = makeStore()
    expect(store.isAvailable).toBe(false)

    const result = store.load()
    expect(result.outcome).toBe('fresh')
    expect(result.data.coins).toBe(0)

    // Saving must not throw, it just cannot persist.
    expect(() => {
      store.save({ coins: 5, vehicleId: 'taxi', upgrades: {} })
      store.flush()
    }).not.toThrow()
  })

  it('surfaces a write failure that happens after construction', () => {
    const store = makeStore()
    expect(store.isAvailable).toBe(true)

    storage.failWrites = true
    store.save({ coins: 5, vehicleId: 'taxi', upgrades: {} })
    store.flush()

    // Both the primary write and the retry failed, so persistence is off.
    expect(store.isAvailable).toBe(false)
  })

  it('clear removes the save and its backup', () => {
    const store = makeStore()
    store.save({ coins: 100, vehicleId: 'taxi', upgrades: {} })
    store.flush()
    store.save({ coins: 200, vehicleId: 'taxi', upgrades: {} })
    store.flush()

    expect(storage.raw.has('test-save')).toBe(true)
    expect(storage.raw.has('test-save.backup')).toBe(true)

    store.clear()
    expect(storage.raw.has('test-save')).toBe(false)
    expect(storage.raw.has('test-save.backup')).toBe(false)
    expect(makeStore().load().outcome).toBe('fresh')
  })

  it('exports the raw save for debugging', () => {
    const store = makeStore()
    store.save({ coins: 7, vehicleId: 'taxi', upgrades: {} })
    store.flush()

    const json = store.exportJson()
    expect(json).toBeTruthy()
    expect(JSON.parse(json!).data.coins).toBe(7)
  })

  it('flush with nothing pending is a no-op', () => {
    const store = makeStore()
    const spy = vi.spyOn(storage, 'setItem')
    store.flush()
    expect(spy).not.toHaveBeenCalled()
  })
})
