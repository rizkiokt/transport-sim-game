import { describe, expect, it } from 'vitest'

import { InfiniteRoads } from './infinite-roads.js'
import { CHUNK_SIZE, WORLD_RADIUS_FOR_TIER } from './world-streamer.js'
import { RENDER_PROFILES } from '../../engine/three/renderer.js'
import { createDefaultSave, sanitizeSave } from '../save.js'

function makeRoads(): InfiniteRoads {
  return new InfiniteRoads({ blockSize: 260, roadWidth: 64, pavedWidth: 96 })
}

describe('InfiniteRoads', () => {
  it('matches a brute-force search over the surrounding gridlines', () => {
    // The whole point of the arithmetic lookup is that it gives the same
    // answer as scanning real geometry would. This checks it against an
    // explicit search over every gridline near the query, including well
    // outside any finite town — where the old segment-array network simply
    // had no roads to find.
    const roads = makeRoads()

    let seed = 5
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    for (let i = 0; i < 400; i++) {
      // Deliberately spans negative coordinates and far-away blocks.
      const x = rand() * 8000 - 4000
      const z = rand() * 8000 - 4000

      const hit = roads.nearestRoad(x, z)

      let best = Infinity
      const cx = Math.round(x / 260)
      const cz = Math.round(z / 260)
      for (let n = -2; n <= 2; n++) {
        best = Math.min(best, Math.abs(z - (cz + n) * 260))
        best = Math.min(best, Math.abs(x - (cx + n) * 260))
      }

      expect(hit.distance).toBeCloseTo(best, 6)
    }
  })

  it('puts the returned point on the road it matched', () => {
    const roads = makeRoads()
    for (const [x, z] of [
      [130, 6],
      [6, 130],
      [-1040, 33],
      [523.5, -777.25],
    ] as Array<[number, number]>) {
      const hit = roads.nearestRoad(x, z)
      expect(Math.hypot(hit.x - x, hit.z - z)).toBeCloseTo(hit.distance, 6)
      // The matched point must itself be centred on a gridline.
      const onGrid = hit.horizontal ? hit.z / 260 : hit.x / 260
      expect(Math.abs(onGrid - Math.round(onGrid))).toBeLessThan(1e-9)
    }
  })

  it('returns a tangent aligned with the matched road', () => {
    const roads = makeRoads()
    // Just above a horizontal road: tangent should be along X (angle 0).
    const horizontal = roads.nearestRoad(130, 6)
    expect(Math.abs(Math.sin(horizontal.tangent))).toBeLessThan(1e-6)

    // Just beside a vertical road: tangent should be along Z (angle PI/2).
    const vertical = roads.nearestRoad(6, 130)
    expect(Math.abs(Math.cos(vertical.tangent))).toBeLessThan(1e-6)
  })

  it('reports points on the centreline as on-road', () => {
    const roads = makeRoads()
    expect(roads.isOnRoad(130, 0)).toBe(true)
    expect(roads.isOnRoad(130, 20)).toBe(true)
    expect(roads.isOnRoad(130, 60)).toBe(false)
  })

  it('finds roads arbitrarily far from the origin', () => {
    // The failure mode the finite network had: past the last row of blocks
    // there was nothing to snap to, so a car driving out kept its last hit
    // forever. Every coordinate must be within half a block of a road.
    const roads = makeRoads()
    for (const distance of [1e3, 1e5, 1e7]) {
      const hit = roads.nearestRoad(distance + 37, -distance - 91)
      expect(hit.distance).toBeLessThanOrEqual(130 + 1e-6)
      expect(Number.isFinite(hit.x)).toBe(true)
      expect(Number.isFinite(hit.z)).toBe(true)
    }
  })

  it('places sidewalk spots off the asphalt but on the pavement', () => {
    const roads = makeRoads()
    // Two of the block's four bounding roads, both kerbs of each.
    const spots = roads.buildSidewalkSpots(0, 0, 110)
    expect(spots.length).toBeGreaterThanOrEqual(4)

    for (const spot of spots) {
      expect(roads.isOnRoad(spot.x, spot.z)).toBe(false)
      expect(roads.isOnPavement(spot.x, spot.z)).toBe(true)
    }
  })

  it('keeps sidewalk spots clear of intersections', () => {
    const roads = makeRoads()
    // Several blocks, including negative indices.
    for (const [bx, bz] of [
      [0, 0],
      [3, 1],
      [-2, -5],
    ] as Array<[number, number]>) {
      for (const spot of roads.buildSidewalkSpots(bx, bz, 110)) {
        expect(roads.distanceToJunction(spot.x, spot.z)).toBeGreaterThan(40)
      }
    }
  })
})

describe('save sanitising', () => {
  it('passes a healthy save through unchanged', () => {
    const save = createDefaultSave()
    save.coins = 120
    const cleaned = sanitizeSave(save)
    expect(cleaned.coins).toBe(120)
    expect(cleaned.activeVehicle).toBe('taxi')
  })

  it('repairs negative and absurd coins', () => {
    const save = createDefaultSave()
    save.coins = -50
    expect(sanitizeSave(save).coins).toBe(0)
    save.coins = 1e12
    expect(sanitizeSave(save).coins).toBe(9_999_999)
  })

  it('rounds fractional coins', () => {
    const save = createDefaultSave()
    save.coins = 12.7
    expect(sanitizeSave(save).coins).toBe(13)
  })

  it('drops unknown vehicles and repairs the active pointer', () => {
    const save = createDefaultSave()
    save.ownedVehicles = ['taxi', 'hoverboard-9000']
    save.activeVehicle = 'hoverboard-9000'
    const cleaned = sanitizeSave(save)
    expect(cleaned.ownedVehicles).toEqual(['taxi'])
    expect(cleaned.activeVehicle).toBe('taxi')
  })

  it('recovers even from an empty owned list', () => {
    const save = createDefaultSave()
    save.ownedVehicles = []
    save.activeVehicle = 'nope'
    const cleaned = sanitizeSave(save)
    expect(cleaned.ownedVehicles).toEqual(['taxi'])
    expect(cleaned.activeVehicle).toBe('taxi')
  })

  it('coerces a non-boolean muted flag', () => {
    const save = createDefaultSave()
    ;(save as { muted: unknown }).muted = 'yes'
    expect(sanitizeSave(save).muted).toBe(true)
  })
})

describe('streaming and draw distance stay in step', () => {
  it('never lets a tier see further than its world has been built', () => {
    // The failure this prevents is subtle and ugly: a far plane beyond the
    // loaded radius shows the city ending at a hard line in mid-air, with
    // clear sky behind it. It is easy to reintroduce by tuning either number
    // alone, so the relationship is asserted rather than commented.
    for (const tier of ['low', 'medium', 'high'] as const) {
      const guaranteed = WORLD_RADIUS_FOR_TIER[tier] * CHUNK_SIZE
      const profile = RENDER_PROFILES[tier]
      expect(profile.drawDistance).toBeLessThanOrEqual(guaranteed)
      // And the fog must close before the geometry does, or the cut-off is
      // visible even within the loaded area.
      expect(profile.drawDistance * 0.95).toBeLessThan(guaranteed)
    }
  })
})
