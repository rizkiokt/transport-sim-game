import { describe, expect, it } from 'vitest'

import {
  UPGRADES,
  computeEffects,
  getUpgrade,
  upgradeCost,
  upgradeMultiplier,
} from '../content/upgrades.js'
import { createDefaultSave, parseSaveFile, sanitizeSave, SAVE_VERSION } from './save.js'

describe('upgrade economy', () => {
  it('makes the first upgrade of every track affordable after one or two rides', () => {
    // A ride pays roughly 20 coins. For a 6-year-old the first upgrade has to
    // land in the same sitting, or it is a wall rather than a goal.
    for (const def of UPGRADES) {
      const first = upgradeCost(def, 0)
      expect(first).not.toBeNull()
      expect(first!).toBeLessThanOrEqual(40)
    }
  })

  it('prices every level as a round number', () => {
    // A child compares the price against their coin counter by eye; odd
    // numbers make that harder for no benefit.
    for (const def of UPGRADES) {
      for (let level = 0; level < def.maxLevel; level++) {
        expect(upgradeCost(def, level)! % 5).toBe(0)
      }
    }
  })

  it('costs strictly more at each level', () => {
    for (const def of UPGRADES) {
      let previous = 0
      for (let level = 0; level < def.maxLevel; level++) {
        const cost = upgradeCost(def, level)!
        expect(cost).toBeGreaterThan(previous)
        previous = cost
      }
    }
  })

  it('returns null once a track is maxed', () => {
    for (const def of UPGRADES) {
      expect(upgradeCost(def, def.maxLevel)).toBeNull()
      expect(upgradeCost(def, def.maxLevel + 3)).toBeNull()
    }
  })

  it('keeps the full upgrade path within a sensible session', () => {
    // Everything maxed should cost a few hundred coins, not thousands: the
    // whole tree has to be reachable, or the last levels are decoration.
    let total = 0
    for (const def of UPGRADES) {
      for (let level = 0; level < def.maxLevel; level++) total += upgradeCost(def, level)!
    }
    expect(total).toBeGreaterThan(200)
    expect(total).toBeLessThan(1500)
  })

  it('multiplies from 1 at level 0 and rises monotonically', () => {
    for (const def of UPGRADES) {
      expect(upgradeMultiplier(def, 0)).toBe(1)
      for (let level = 1; level <= def.maxLevel; level++) {
        expect(upgradeMultiplier(def, level)).toBeGreaterThan(upgradeMultiplier(def, level - 1))
      }
    }
  })

  it('clamps multipliers for out-of-range levels', () => {
    const def = getUpgrade('speed')!
    expect(upgradeMultiplier(def, -5)).toBe(1)
    expect(upgradeMultiplier(def, 999)).toBe(upgradeMultiplier(def, def.maxLevel))
  })

  it('never makes the car more than modestly faster', () => {
    // Top speed feeds collision detection and the road assist; an unbounded
    // multiplier would let the car outrun both.
    const maxed = Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxLevel]))
    const effects = computeEffects(maxed)
    expect(effects.speed).toBeLessThanOrEqual(1.6)
    expect(effects.grip).toBeLessThanOrEqual(1.6)
  })

  it('treats an empty or unknown upgrade map as neutral', () => {
    expect(computeEffects({})).toEqual({ speed: 1, boost: 1, grip: 1, fare: 1 })
    expect(computeEffects({ nonsense: 9 })).toEqual({ speed: 1, boost: 1, grip: 1, fare: 1 })
  })
})

describe('save sanitising with upgrades', () => {
  it('drops unknown upgrade tracks', () => {
    const save = createDefaultSave()
    save.upgrades = { speed: 2, hyperdrive: 5 }
    const cleaned = sanitizeSave(save)
    expect(cleaned.upgrades).toEqual({ speed: 2 })
  })

  it('clamps levels above the track maximum', () => {
    const save = createDefaultSave()
    save.upgrades = { speed: 999 }
    expect(sanitizeSave(save).upgrades['speed']).toBe(getUpgrade('speed')!.maxLevel)
  })

  it('clamps negative and non-finite levels', () => {
    const save = createDefaultSave()
    save.upgrades = { speed: -3, grip: Number.NaN, fare: Infinity }
    const cleaned = sanitizeSave(save)
    expect(cleaned.upgrades['speed']).toBe(0)
    expect(cleaned.upgrades['grip']).toBeUndefined()
    expect(cleaned.upgrades['fare']).toBeUndefined()
  })

  it('survives a save with no upgrades field at all', () => {
    const save = createDefaultSave()
    delete (save as Partial<typeof save>).upgrades
    expect(() => sanitizeSave(save)).not.toThrow()
    expect(sanitizeSave(save).upgrades).toEqual({})
  })
})

describe('save file import', () => {
  function fileFor(data: unknown, version = SAVE_VERSION): string {
    return JSON.stringify({
      game: 'transport-simulator',
      version,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data,
    })
  }

  it('round-trips a healthy save', () => {
    const save = createDefaultSave()
    save.coins = 250
    save.upgrades = { speed: 2 }

    const result = parseSaveFile(fileFor(save))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.coins).toBe(250)
    expect(result.save.upgrades).toEqual({ speed: 2 })
    expect(result.migrated).toBe(false)
  })

  it('migrates a v1 file that predates upgrades', () => {
    const v1 = {
      coins: 60,
      totalRides: 3,
      activeVehicle: 'taxi',
      ownedVehicles: ['taxi'],
      muted: false,
    }
    const result = parseSaveFile(fileFor(v1, 1))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migrated).toBe(true)
    expect(result.save.upgrades).toEqual({})
    expect(result.save.coins).toBe(60)
  })

  it('rejects a file from a newer version rather than mangling it', () => {
    const result = parseSaveFile(fileFor(createDefaultSave(), SAVE_VERSION + 1))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/newer version/i)
  })

  it('rejects files that are not saves', () => {
    expect(parseSaveFile('not json at all{{').ok).toBe(false)
    expect(parseSaveFile(JSON.stringify({ hello: 'world' })).ok).toBe(false)
    expect(parseSaveFile(JSON.stringify({ game: 'some-other-game', version: 1 })).ok).toBe(false)
  })

  it('rejects a save whose contents are damaged', () => {
    const result = parseSaveFile(fileFor({ coins: 'lots', totalRides: 1 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/damaged/i)
  })

  it('repairs a hand-edited file instead of trusting it', () => {
    // Save files are plain JSON on a user's disk, so they can and will be
    // edited. Importing must clamp rather than accept whatever it finds.
    const tampered = {
      ...createDefaultSave(),
      coins: 1e12,
      upgrades: { speed: 99, fake: 4 },
    }
    const result = parseSaveFile(fileFor(tampered))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.save.coins).toBe(9_999_999)
    expect(result.save.upgrades).toEqual({ speed: getUpgrade('speed')!.maxLevel })
  })
})
