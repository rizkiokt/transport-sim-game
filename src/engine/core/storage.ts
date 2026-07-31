/**
 * Versioned save/load on top of localStorage.
 *
 * A child's progress is the most emotionally valuable thing in this game —
 * losing it is worse than any bug. So this layer is defensive:
 *
 * - Every save is written with a schema version, and old saves are migrated
 *   forward step by step rather than discarded.
 * - Anything unreadable falls back to a fresh save instead of throwing and
 *   leaving a black screen.
 * - A backup of the previous save is kept, so a bad write or a mid-write
 *   crash costs at most one session.
 * - Writes are debounced and coalesced; localStorage is synchronous and
 *   writing on every coin pickup would cause frame hitches.
 * - Everything degrades gracefully when storage is unavailable (private
 *   browsing, disabled cookies) — the game runs, it just cannot persist.
 */

export type Migration<T = unknown> = (data: T) => unknown

export interface StorageOptions<T> {
  /** localStorage key. */
  key: string
  /** Current schema version. Bump when the shape changes. */
  version: number
  /** Produce a brand-new save. */
  createDefault: () => T
  /**
   * Migrations keyed by the version they upgrade *from*. To go from v1 to v3,
   * provide `{ 1: v1ToV2, 2: v2ToV3 }`.
   */
  migrations?: Record<number, Migration>
  /**
   * Last line of defence: reject structurally invalid data even after
   * migration. Returning false discards the save and starts fresh.
   */
  validate?: (data: unknown) => boolean
  /** Milliseconds to coalesce writes over. */
  writeDebounceMs?: number
}

interface Envelope {
  version: number
  savedAt: number
  data: unknown
}

export type LoadOutcome = 'loaded' | 'migrated' | 'recovered' | 'fresh'

export interface LoadResult<T> {
  data: T
  outcome: LoadOutcome
  /** Set when something went wrong, for the debug overlay. */
  note?: string
}

export class SaveStore<T extends object> {
  readonly #key: string
  readonly #backupKey: string
  readonly #version: number
  readonly #createDefault: () => T
  readonly #migrations: Record<number, Migration>
  readonly #validate: ((data: unknown) => boolean) | undefined
  readonly #debounceMs: number

  #pending: T | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #available: boolean

  /** Set when a write fails, so the UI can warn that progress isn't saving. */
  #lastError: string | null = null

  constructor(options: StorageOptions<T>) {
    this.#key = options.key
    this.#backupKey = `${options.key}.backup`
    this.#version = options.version
    this.#createDefault = options.createDefault
    this.#migrations = options.migrations ?? {}
    this.#validate = options.validate
    this.#debounceMs = options.writeDebounceMs ?? 800
    this.#available = probeStorage()

    // Flush before the tab goes away, otherwise a debounced write is lost.
    // `visibilitychange` is the reliable signal on mobile Safari; `pagehide`
    // covers bfcache navigation. `beforeunload` alone is not enough.
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flush()
      })
      window.addEventListener('pagehide', () => this.flush())
    }
  }

  get isAvailable(): boolean {
    return this.#available
  }

  get lastError(): string | null {
    return this.#lastError
  }

  /** Read, migrate, and validate. Always returns usable data. */
  load(): LoadResult<T> {
    if (!this.#available) {
      return { data: this.#createDefault(), outcome: 'fresh', note: 'storage unavailable' }
    }

    const primary = this.#readSlot(this.#key)
    if (primary.data) return primary as LoadResult<T>

    // Primary was missing or corrupt — try the backup before giving up.
    const backup = this.#readSlot(this.#backupKey)
    if (backup.data) {
      return {
        data: backup.data as T,
        outcome: 'recovered',
        note: primary.note ?? 'primary save unreadable',
      }
    }

    return {
      data: this.#createDefault(),
      outcome: 'fresh',
      ...(primary.note !== undefined ? { note: primary.note } : {}),
    }
  }

  /**
   * Queue a save. Repeated calls within the debounce window collapse into one
   * write, so gameplay can call this freely.
   */
  save(data: T): void {
    if (!this.#available) return
    this.#pending = data
    if (this.#timer !== null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.flush()
    }, this.#debounceMs)
  }

  /** Write immediately, bypassing the debounce. */
  flush(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }

    const data = this.#pending
    if (data === null || !this.#available) return
    this.#pending = null

    const envelope: Envelope = {
      version: this.#version,
      savedAt: Date.now(),
      data,
    }

    try {
      const serialized = JSON.stringify(envelope)

      // Roll the current save into the backup slot before overwriting, so a
      // failed or partial write can't destroy both copies.
      const current = localStorage.getItem(this.#key)
      if (current !== null) {
        try {
          localStorage.setItem(this.#backupKey, current)
        } catch {
          // Backup is best-effort; a full quota shouldn't block the real save.
        }
      }

      localStorage.setItem(this.#key, serialized)
      this.#lastError = null
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error)
      // Quota exceeded is the common case. Drop the backup to free room and
      // retry once — a saved game beats a saved backup.
      try {
        localStorage.removeItem(this.#backupKey)
        localStorage.setItem(this.#key, JSON.stringify(envelope))
        this.#lastError = null
      } catch {
        this.#available = false
      }
    }
  }

  /** Delete the save and its backup. Gate this behind a parent check. */
  clear(): void {
    this.#pending = null
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    if (!this.#available) return
    try {
      localStorage.removeItem(this.#key)
      localStorage.removeItem(this.#backupKey)
    } catch {
      // Nothing useful to do.
    }
  }

  /** Serialise the current save for export/debugging. */
  exportJson(): string | null {
    if (!this.#available) return null
    try {
      return localStorage.getItem(this.#key)
    } catch {
      return null
    }
  }

  #readSlot(key: string): { data: T | null; outcome: LoadOutcome; note?: string } {
    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch (error) {
      return {
        data: null,
        outcome: 'fresh',
        note: `read failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    if (raw === null) return { data: null, outcome: 'fresh' }

    let envelope: Envelope
    try {
      envelope = JSON.parse(raw) as Envelope
    } catch {
      return { data: null, outcome: 'fresh', note: 'save was not valid JSON' }
    }

    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      typeof envelope.version !== 'number' ||
      envelope.data === undefined
    ) {
      return { data: null, outcome: 'fresh', note: 'save envelope malformed' }
    }

    let version = envelope.version
    let data: unknown = envelope.data
    let migrated = false

    if (version > this.#version) {
      // The save came from a newer build than the one running. Refuse rather
      // than risk mangling it — the player may just need to reload.
      return { data: null, outcome: 'fresh', note: `save is from a newer version (${version})` }
    }

    while (version < this.#version) {
      const migration = this.#migrations[version]
      if (!migration) {
        return { data: null, outcome: 'fresh', note: `no migration from version ${version}` }
      }
      try {
        data = migration(data)
      } catch (error) {
        return {
          data: null,
          outcome: 'fresh',
          note: `migration from ${version} failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      version++
      migrated = true
    }

    if (this.#validate && !this.#validate(data)) {
      return { data: null, outcome: 'fresh', note: 'save failed validation' }
    }

    return { data: data as T, outcome: migrated ? 'migrated' : 'loaded' }
  }
}

/**
 * Detect whether localStorage actually works. Safari in private mode exposes
 * the API but throws on write, so we have to try a real round-trip.
 */
function probeStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const probe = '__storage_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}
