/**
 * The game's save schema and store.
 *
 * Kept small and flat: every field must survive JSON round-tripping and be
 * cheap to validate. Version history:
 *   v1 — coins, totalRides, activeVehicle, ownedVehicles, muted.
 */

import { SaveStore } from '../engine/core/storage.js'
import { VEHICLES } from '../content/vehicles.js'

export interface GameSave {
  coins: number
  totalRides: number
  activeVehicle: string
  ownedVehicles: string[]
  muted: boolean
}

export function createDefaultSave(): GameSave {
  return {
    coins: 0,
    totalRides: 0,
    activeVehicle: 'taxi',
    ownedVehicles: ['taxi'],
    muted: false,
  }
}

const KNOWN_VEHICLE_IDS = new Set(VEHICLES.map((v) => v.id))

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
 * Repair a loaded save in place: clamp values a bug (or curious hand-editing)
 * could have produced, and drop references to vehicles that no longer exist.
 * The active vehicle must always be owned and known.
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
  return save
}

export function createSaveStore(): SaveStore<GameSave> {
  return new SaveStore<GameSave>({
    key: 'transport-sim.save',
    version: 1,
    createDefault: createDefaultSave,
    validate,
  })
}
