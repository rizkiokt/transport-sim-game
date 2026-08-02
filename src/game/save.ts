/**
 * The game's save schema and store.
 *
 * Progress lives in two places, deliberately:
 *
 * - **Browser storage** is the automatic one. The child never thinks about
 *   it; it just works between sessions.
 * - **A file** is the one a parent can control. Browser storage is far more
 *   fragile than people expect — clearing site data, private browsing, iOS
 *   evicting storage from sites you have not visited in a while, or simply
 *   moving to a new device all wipe it. Being able to export a save to a file
 *   and load it back is the difference between "we lost your taxi" and "hang
 *   on, I'll get it back".
 *
 * Version history:
 *   v1 — coins, totalRides, activeVehicle, ownedVehicles, muted.
 *   v2 — adds `upgrades`, a per-track level map.
 *   v3 — adds accessibility and quality preferences.
 *   v4 — adds `drivers`: the company's hired staff and their vehicles.
 */

import { SaveStore } from '../engine/core/storage.js'
import { VEHICLES } from '../content/vehicles.js'
import { UPGRADES } from '../content/upgrades.js'

export const SAVE_VERSION = 4
const SAVE_KEY = 'transport-sim.save'

export interface GameSave {
  coins: number
  totalRides: number
  activeVehicle: string
  ownedVehicles: string[]
  muted: boolean
  /** Upgrade track id -> level owned. Missing means level 0. */
  upgrades: Record<string, number>
  /**
   * Accessibility and quality preferences.
   *
   * These persist because they are the settings a PARENT sets on behalf of a
   * child — gentler motion for someone prone to motion sickness, lower
   * quality on a struggling tablet. Making them reset on every reload means
   * re-setting them every session, which is precisely backwards.
   */
  reducedMotion: boolean
  quality: 'auto' | 'low' | 'medium' | 'high'
  /**
   * Hired drivers, one per vehicle at most.
   *
   * Trip progress persists too, so quitting halfway through a driver's run
   * does not quietly throw that time away.
   */
  drivers: Array<{ vehicleId: string; name: string; progress: number }>
}

export function createDefaultSave(): GameSave {
  return {
    coins: 0,
    totalRides: 0,
    activeVehicle: 'taxi',
    ownedVehicles: ['taxi'],
    muted: false,
    upgrades: {},
    reducedMotion: false,
    quality: 'auto',
    drivers: [],
  }
}

const KNOWN_VEHICLE_IDS = new Set(VEHICLES.map((v) => v.id))
const QUALITY_VALUES = new Set<GameSave['quality']>(['auto', 'low', 'medium', 'high'])
const UPGRADE_LIMITS = new Map(UPGRADES.map((u) => [u.id as string, u.maxLevel]))

function validate(data: unknown): boolean {
  const d = data as Partial<GameSave> | null
  if (typeof d !== 'object' || d === null) return false
  if (typeof d.coins !== 'number' || !Number.isFinite(d.coins) || d.coins < 0) return false
  if (typeof d.totalRides !== 'number' || d.totalRides < 0) return false
  if (typeof d.activeVehicle !== 'string') return false
  if (!Array.isArray(d.ownedVehicles)) return false
  return true
}

/**
 * Repair a loaded save in place.
 *
 * This runs on every load, including saves imported from a file — which a
 * user could plausibly have hand-edited. Everything is clamped to a legal
 * range rather than rejected, because a slightly wrong save that still loads
 * is a far better outcome for a child than a correct refusal.
 */
export function sanitizeSave(save: GameSave): GameSave {
  save.coins = Math.max(0, Math.min(9_999_999, Math.round(save.coins)))
  save.totalRides = Math.max(0, Math.round(save.totalRides))

  save.ownedVehicles = save.ownedVehicles.filter((id) => KNOWN_VEHICLE_IDS.has(id))
  if (save.ownedVehicles.length === 0) save.ownedVehicles = ['taxi']
  if (!save.ownedVehicles.includes(save.activeVehicle)) {
    save.activeVehicle = save.ownedVehicles[0]!
  }

  save.muted = Boolean(save.muted)
  save.reducedMotion = Boolean(save.reducedMotion)
  if (!QUALITY_VALUES.has(save.quality)) save.quality = 'auto'

  // Drivers: at most one per vehicle, only for vehicles actually owned, and
  // never for a vehicle that does not exist. A hand-edited save that assigned
  // three drivers to the bus would otherwise triple that vehicle's income.
  const seenDrivers = new Set<string>()
  save.drivers = (Array.isArray(save.drivers) ? save.drivers : []).filter((d) => {
    if (typeof d !== 'object' || d === null) return false
    if (typeof d.vehicleId !== 'string' || !save.ownedVehicles.includes(d.vehicleId)) return false
    if (seenDrivers.has(d.vehicleId)) return false
    seenDrivers.add(d.vehicleId)
    d.name = typeof d.name === 'string' && d.name.length > 0 ? d.name.slice(0, 16) : 'Driver'
    d.progress =
      typeof d.progress === 'number' && Number.isFinite(d.progress)
        ? Math.max(0, Math.min(1, d.progress))
        : 0
    return true
  })

  // Drop unknown tracks and clamp levels; an out-of-range level would
  // otherwise scale handling without limit.
  const cleanUpgrades: Record<string, number> = {}
  for (const [id, level] of Object.entries(save.upgrades ?? {})) {
    const max = UPGRADE_LIMITS.get(id)
    if (max === undefined) continue
    if (typeof level !== 'number' || !Number.isFinite(level)) continue
    cleanUpgrades[id] = Math.max(0, Math.min(max, Math.round(level)))
  }
  save.upgrades = cleanUpgrades

  return save
}

export function createSaveStore(): SaveStore<GameSave> {
  return new SaveStore<GameSave>({
    key: SAVE_KEY,
    version: SAVE_VERSION,
    createDefault: createDefaultSave,
    migrations: {
      // v1 had no upgrades at all.
      1: (data: unknown) => ({ ...(data as object), upgrades: {} }),
      // v2 did not persist accessibility or quality preferences.
      2: (data: unknown) => ({ ...(data as object), reducedMotion: false, quality: 'auto' }),
      // v3 predates the company; everyone starts with no staff.
      3: (data: unknown) => ({ ...(data as object), drivers: [] }),
    },
    validate,
  })
}

// ---------------------------------------------------------------- file I/O

/** What an exported save file contains. */
interface SaveFile {
  game: 'transport-simulator'
  version: number
  exportedAt: string
  data: GameSave
}

/**
 * Trigger a download of the current save.
 *
 * Uses a blob URL and a synthetic click, which is the only way to save a file
 * from a static page with no server. The URL is revoked afterwards so the
 * blob does not leak for the life of the tab.
 */
export function exportSaveToFile(save: GameSave, filename?: string): void {
  const payload: SaveFile = {
    game: 'transport-simulator',
    version: SAVE_VERSION,
    exportedAt: new Date().toISOString(),
    data: save,
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename ?? `transport-simulator-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()

  // Give the browser a moment to start the download before dropping the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export type ImportResult =
  | { ok: true; save: GameSave; migrated: boolean }
  | { ok: false; reason: string }

/**
 * Parse a save file's text.
 *
 * Every failure path returns a reason rather than throwing, because this is
 * driven by a file picker and the caller has to be able to tell the user what
 * went wrong with the file they chose.
 */
export function parseSaveFile(text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'That file is not a saved game.' }
  }

  const file = parsed as Partial<SaveFile>
  if (typeof file !== 'object' || file === null || file.game !== 'transport-simulator') {
    return { ok: false, reason: 'That file is not a Transport Simulator save.' }
  }

  const version = typeof file.version === 'number' ? file.version : 0
  if (version > SAVE_VERSION) {
    return { ok: false, reason: 'That save is from a newer version of the game.' }
  }

  let data = file.data as unknown
  let migrated = false

  // Same forward migrations the storage layer applies.
  if (version < 2) {
    data = { ...(data as object), upgrades: {} }
    migrated = true
  }
  if (version < 3) {
    data = { ...(data as object), reducedMotion: false, quality: 'auto' }
    migrated = true
  }
  if (version < 4) {
    data = { ...(data as object), drivers: [] }
    migrated = true
  }

  if (!validate(data)) {
    return { ok: false, reason: 'That save file is damaged.' }
  }

  return { ok: true, save: sanitizeSave(data as GameSave), migrated }
}

/** Read a File chosen from a picker and parse it. */
export async function importSaveFromFile(file: File): Promise<ImportResult> {
  try {
    const text = await file.text()
    return parseSaveFile(text)
  } catch {
    return { ok: false, reason: 'That file could not be read.' }
  }
}
