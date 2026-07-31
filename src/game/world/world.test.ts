import { describe, expect, it } from 'vitest'

import { generateCity } from './city.js'
import { RoadNetwork } from './road-network.js'
import { getVehicle } from '../../content/vehicles.js'
import { PlayerVehicle } from '../entities/player-vehicle.js'
import { createDefaultSave, sanitizeSave } from '../save.js'

function makeNetwork(): RoadNetwork {
  return new RoadNetwork({ cols: 4, rows: 3, blockSize: 260, roadWidth: 64, pavedWidth: 96 })
}

describe('RoadNetwork', () => {
  it('creates the right number of segments for a full grid', () => {
    const net = makeNetwork()
    // Horizontal: 3 per row * 3 rows; vertical: 4 per column-row * 2 = 8.
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

      // Brute force over all segments using the generic formula.
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

  it('reports points on the centreline as on-road', () => {
    const net = makeNetwork()
    expect(net.isOnRoad(130, 0)).toBe(true)
    expect(net.isOnRoad(130, 20)).toBe(true) // within half road width
    expect(net.isOnRoad(130, 60)).toBe(false) // past the kerb
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
})

describe('generateCity', () => {
  it('is deterministic for the same seed', () => {
    const a = generateCity({ seed: 'test-town' })
    const b = generateCity({ seed: 'test-town' })

    expect(a.buildings.length).toBe(b.buildings.length)
    expect(a.trees.length).toBe(b.trees.length)
    expect(a.buildings.map((x) => [x.x, x.y, x.w, x.h])).toEqual(
      b.buildings.map((x) => [x.x, x.y, x.w, x.h]),
    )
  })

  it('differs between seeds', () => {
    const a = generateCity({ seed: 'town-a' })
    const b = generateCity({ seed: 'town-b' })
    expect(a.buildings.map((x) => x.x)).not.toEqual(b.buildings.map((x) => x.x))
  })

  it('keeps every building clear of the pavement', () => {
    const city = generateCity({ seed: 'test-town' })
    for (const b of city.buildings) {
      // All four corners must be off the paved band.
      for (const [cx, cy] of [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x, b.y + b.h],
        [b.x + b.w, b.y + b.h],
      ] as const) {
        expect(city.roads.isOnPavement(cx, cy)).toBe(false)
      }
    }
  })

  it('provides enough sidewalk spots for varied rides', () => {
    const city = generateCity({ seed: 'test-town' })
    expect(city.sidewalkSpots.length).toBeGreaterThan(50)
  })

  it('indexes every building and tree as an obstacle', () => {
    const city = generateCity({ seed: 'test-town' })
    expect(city.obstacles.size).toBe(city.buildings.length + city.trees.length)
  })
})

describe('PlayerVehicle', () => {
  const city = generateCity({ seed: 'physics-town' })

  function makeCar(): PlayerVehicle {
    const car = new PlayerVehicle(city, getVehicle('taxi'))
    // Spawn on a road centreline heading along it.
    car.place(city.roads.blockSize, city.roads.blockSize, 0)
    return car
  }

  function step(car: PlayerVehicle, seconds: number): void {
    const dt = 1 / 60
    for (let i = 0; i < Math.round(seconds / dt); i++) car.update(dt)
  }

  it('accelerates under throttle and reaches near top speed', () => {
    const car = makeCar()
    car.controls.throttle = 1
    step(car, 3)
    expect(car.speed).toBeGreaterThan(car.maxSpeed * 0.9)
  })

  it('coasts to a stop when the throttle is released', () => {
    const car = makeCar()
    car.controls.throttle = 1
    step(car, 2)
    car.controls.throttle = 0
    step(car, 3)
    expect(Math.abs(car.speed)).toBeLessThan(1)
  })

  it('brakes harder than it coasts', () => {
    const carA = makeCar()
    carA.controls.throttle = 1
    step(carA, 2)
    carA.controls.throttle = 0
    carA.controls.brake = 1
    step(carA, 0.5)

    const carB = makeCar()
    carB.controls.throttle = 1
    step(carB, 2)
    carB.controls.throttle = 0
    step(carB, 0.5)

    expect(Math.abs(carA.speed)).toBeLessThan(Math.abs(carB.speed))
  })

  it('cannot spin in place at a standstill', () => {
    const car = makeCar()
    const before = car.heading
    car.controls.steer = 1
    step(car, 2)
    expect(Math.abs(car.heading - before)).toBeLessThan(0.02)
  })

  it('turns when moving', () => {
    const car = makeCar()
    car.controls.throttle = 1
    car.controls.steer = 1
    step(car, 1.5)
    expect(Math.abs(car.heading)).toBeGreaterThan(0.3)
  })

  it('reverses slowly when brake is held at a standstill', () => {
    const car = makeCar()
    car.controls.brake = 1
    step(car, 2)
    expect(car.speed).toBeLessThan(-10)
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(car.def.handling.reverseSpeed + 1)
  })

  it('stays inside the world bounds', () => {
    const car = makeCar()
    car.place(city.bounds.minX + 10, city.bounds.minY + 10, Math.PI) // drive at the corner
    car.controls.throttle = 1
    step(car, 4)
    expect(car.x).toBeGreaterThanOrEqual(city.bounds.minX)
    expect(car.y).toBeGreaterThanOrEqual(city.bounds.minY)
  })

  it('never ends up inside a building', () => {
    const car = makeCar()
    // Aim straight at the nearest building's centre and floor it.
    const target = city.buildings[0]!
    const bx = target.x + target.w / 2
    const by = target.y + target.h / 2
    car.place(bx - 200, by, 0)
    car.heading = Math.atan2(by - car.y, bx - car.x)
    car.controls.throttle = 1
    step(car, 4)

    // The car's centre must remain outside the AABB (its radius keeps it out).
    const inside =
      car.x > target.x && car.x < target.x + target.w && car.y > target.y && car.y < target.y + target.h
    expect(inside).toBe(false)
  })

  it('road assist keeps a hands-off car near the centreline', () => {
    const car = makeCar()
    // Start slightly off-centre, pointing slightly off-axis.
    car.place(city.roads.blockSize + 40, city.roads.blockSize + 14, 0.18)
    car.controls.throttle = 1
    step(car, 2.5)

    const road = city.roads.nearestRoad(car.x, car.y)
    expect(road.distance).toBeLessThan(12)
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
})
