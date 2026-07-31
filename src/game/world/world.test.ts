import { describe, expect, it } from 'vitest'

import { RoadNetwork } from './road-network.js'
import { createDefaultSave, sanitizeSave } from '../save.js'

function makeNetwork(): RoadNetwork {
  return new RoadNetwork({ cols: 4, rows: 3, blockSize: 260, roadWidth: 64, pavedWidth: 96 })
}

describe('RoadNetwork', () => {
  it('creates the right number of segments for a full grid', () => {
    const net = makeNetwork()
    // Horizontal: 3 per row * 3 rows; vertical: 4 per column * 2 rows.
    expect(net.segments.length).toBe(3 * 3 + 4 * 2)
  })

  it('nearestRoad matches a brute-force segment search', () => {
    const net = makeNetwork()

    let seed = 5
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    for (let i = 0; i < 200; i++) {
      const x = rand() * 1000 - 100
      const y = rand() * 800 - 100

      const hit = net.nearestRoad(x, y)

      let best = Infinity
      for (const s of net.segments) {
        const dx = s.bx - s.ax
        const dy = s.by - s.ay
        const lenSq = dx * dx + dy * dy
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / lenSq))
        const px = s.ax + dx * t
        const py = s.ay + dy * t
        best = Math.min(best, Math.hypot(x - px, y - py))
      }

      expect(hit.distance).toBeCloseTo(best, 6)
    }
  })

  it('returns a tangent aligned with the matched segment', () => {
    const net = makeNetwork()
    // Just above a horizontal road: tangent should be along X (angle 0).
    const horizontal = net.nearestRoad(130, 6)
    expect(Math.abs(Math.sin(horizontal.tangent))).toBeLessThan(1e-6)

    // Just beside a vertical road: tangent should be along Y (angle PI/2).
    const vertical = net.nearestRoad(6, 130)
    expect(Math.abs(Math.cos(vertical.tangent))).toBeLessThan(1e-6)
  })

  it('reports points on the centreline as on-road', () => {
    const net = makeNetwork()
    expect(net.isOnRoad(130, 0)).toBe(true)
    expect(net.isOnRoad(130, 20)).toBe(true)
    expect(net.isOnRoad(130, 60)).toBe(false)
  })

  it('places sidewalk spots off the asphalt but on the pavement', () => {
    const net = makeNetwork()
    const spots = net.buildSidewalkSpots(110)
    expect(spots.length).toBeGreaterThan(10)

    for (const spot of spots) {
      expect(net.isOnRoad(spot.x, spot.y)).toBe(false)
      expect(net.isOnPavement(spot.x, spot.y)).toBe(true)
    }
  })

  it('keeps sidewalk spots clear of intersections', () => {
    const net = makeNetwork()
    const spots = net.buildSidewalkSpots(110)

    // No spot should sit within the paved footprint of a grid intersection.
    for (const spot of spots) {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const dx = spot.x - col * 260
          const dy = spot.y - row * 260
          expect(Math.hypot(dx, dy)).toBeGreaterThan(40)
        }
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
