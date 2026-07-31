/**
 * Physics tests.
 *
 * These run headlessly against a real generated city, so they exercise the
 * actual collision index and road geometry rather than a mock. Three.js is
 * only touched for scene objects, which these tests never render.
 */

import { describe, expect, it } from 'vitest'

import { getVehicle } from '../../content/vehicles.js'
import { generateCity3D, WORLD_SCALE, type City3D, type Obstacle3D } from '../world/city3d.js'
import { Vehicle3D } from './vehicle3d.js'

const city: City3D = generateCity3D('physics-town')

function makeCar(): Vehicle3D {
  const car = new Vehicle3D(city, getVehicle('taxi'))
  // Spawn on an intersection, heading along a road.
  const b = city.roads.blockSize * WORLD_SCALE
  car.place(b, b, 0)
  return car
}

function step(car: Vehicle3D, seconds: number): void {
  const dt = 1 / 60
  for (let i = 0; i < Math.round(seconds / dt); i++) car.update(dt)
}

describe('Vehicle3D', () => {
  it('accelerates under throttle toward top speed', () => {
    const car = makeCar()
    car.controls.throttle = 1
    step(car, 3)
    expect(car.speed).toBeGreaterThan(car.maxSpeed * 0.85)
    expect(car.speed).toBeLessThanOrEqual(car.maxSpeed + 1e-6)
  })

  it('coasts to a stop when the throttle is released', () => {
    const car = makeCar()
    car.controls.throttle = 1
    step(car, 2)
    car.controls.throttle = 0
    step(car, 4)
    expect(Math.abs(car.speed)).toBeLessThan(0.05)
  })

  it('brakes harder than it coasts', () => {
    const braked = makeCar()
    braked.controls.throttle = 1
    step(braked, 2)
    braked.controls.throttle = 0
    braked.controls.brake = 1
    step(braked, 0.4)

    const coasted = makeCar()
    coasted.controls.throttle = 1
    step(coasted, 2)
    coasted.controls.throttle = 0
    step(coasted, 0.4)

    expect(Math.abs(braked.speed)).toBeLessThan(Math.abs(coasted.speed))
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
    expect(Math.abs(car.heading)).toBeGreaterThan(0.25)
  })

  it('reverses slowly when brake is held at a standstill', () => {
    const car = makeCar()
    car.controls.brake = 1
    step(car, 2)
    expect(car.speed).toBeLessThan(-0.5)
    const reverseMax = car.def.handling.reverseSpeed * WORLD_SCALE
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(reverseMax + 1e-6)
  })

  it('is slower off-road than on it', () => {
    const onRoad = makeCar()
    onRoad.controls.throttle = 1
    step(onRoad, 4)
    expect(onRoad.onRoad).toBe(true)

    // The outer grass margin: clear of every building, and far enough from
    // the outermost roads that the car can never stray back onto tarmac.
    const offRoad = makeCar()
    offRoad.place(city.roads.blockSize * WORLD_SCALE, city.bounds.minZ + 1, 0)
    offRoad.controls.throttle = 1
    step(offRoad, 4)

    expect(offRoad.onRoad).toBe(false)
    expect(Math.abs(offRoad.speed)).toBeLessThan(Math.abs(onRoad.speed) * 0.75)
  })

  it('stays inside the world bounds', () => {
    const car = makeCar()
    car.place(city.bounds.minX + 1, city.bounds.minZ + 1, Math.PI)
    car.controls.throttle = 1
    step(car, 5)
    expect(car.x).toBeGreaterThanOrEqual(city.bounds.minX - 1e-6)
    expect(car.z).toBeGreaterThanOrEqual(city.bounds.minZ - 1e-6)
    expect(car.x).toBeLessThanOrEqual(city.bounds.maxX + 1e-6)
    expect(car.z).toBeLessThanOrEqual(city.bounds.maxZ + 1e-6)
  })

  it('never comes to rest inside an obstacle', () => {
    const car = makeCar()

    // Drive at every obstacle near the spawn and confirm none swallow the car.
    const nearby: Obstacle3D[] = []
    city.obstacles.queryRadius(car.x, car.z, 60, nearby)
    expect(nearby.length).toBeGreaterThan(0)

    for (const ob of nearby.slice(0, 25)) {
      car.place(ob.x - 8, ob.y, 0)
      car.heading = Math.atan2(ob.y - car.z, ob.x - car.x)
      car.controls.throttle = 1
      step(car, 3)

      if (ob.kind === 'building') {
        const inside =
          car.x > ob.x - ob.hw && car.x < ob.x + ob.hw && car.z > ob.y - ob.hh && car.z < ob.y + ob.hh
        expect(inside).toBe(false)
      } else {
        expect(Math.hypot(car.x - ob.x, car.z - ob.y)).toBeGreaterThan(ob.r * 0.9)
      }
    }
  })

  it('road assist converges a hands-off car onto the centreline', () => {
    const car = makeCar()
    const b = city.roads.blockSize * WORLD_SCALE
    // Start off-centre and slightly off-axis, then just hold the throttle.
    car.place(b + 3, b + 1.1, 0.16)
    car.controls.throttle = 1
    step(car, 3)

    const road = city.roads.nearestRoad(car.x / WORLD_SCALE, car.z / WORLD_SCALE)
    expect(road.distance * WORLD_SCALE).toBeLessThan(0.2)
    expect(car.onRoad).toBe(true)
  })

  it('assist does not veer the car sideways when crossing an intersection', () => {
    // Regression test. The nearest road at a junction is the one being
    // crossed, so an ungated assist grabs the car and turns it onto the side
    // street mid-junction -- the car visibly fighting the player.
    const car = makeCar()
    const b = city.roads.blockSize * WORLD_SCALE
    car.place(b + 2, b, 0)
    car.controls.throttle = 1

    let worstHeading = 0
    for (let i = 0; i < 240; i++) {
      car.update(1 / 60)
      worstHeading = Math.max(worstHeading, Math.abs(car.heading))
    }

    // Crossing several intersections must never twist the car off its lane.
    expect(worstHeading).toBeLessThan(0.05)
  })

  it('road assist does not prevent a deliberate turn', () => {
    const car = makeCar()
    car.controls.throttle = 1
    step(car, 1)
    const before = car.heading
    car.controls.steer = 1
    step(car, 1.2)
    // A full-lock turn must still change heading substantially.
    expect(Math.abs(car.heading - before)).toBeGreaterThan(0.4)
  })

  it('produces finite state under sustained random input', () => {
    const car = makeCar()
    let seed = 3
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    for (let i = 0; i < 3000; i++) {
      car.controls.throttle = rand() > 0.4 ? 1 : 0
      car.controls.brake = rand() > 0.85 ? 1 : 0
      car.controls.steer = rand() * 2 - 1
      car.update(1 / 60)

      expect(Number.isFinite(car.x)).toBe(true)
      expect(Number.isFinite(car.z)).toBe(true)
      expect(Number.isFinite(car.speed)).toBe(true)
      expect(Number.isFinite(car.heading)).toBe(true)
    }
  })

  it('exposes a speed fraction bounded to 0..1', () => {
    const car = makeCar()
    car.controls.throttle = 1
    step(car, 5)
    expect(car.speedFraction).toBeGreaterThan(0)
    expect(car.speedFraction).toBeLessThanOrEqual(1.0001)
  })
})

describe('generateCity3D', () => {
  it('is deterministic for a given seed', () => {
    const a = generateCity3D('same-seed')
    const b = generateCity3D('same-seed')
    expect(a.sidewalkSpots.length).toBe(b.sidewalkSpots.length)
    expect(a.obstacles.size).toBe(b.obstacles.size)
    a.dispose()
    b.dispose()
  })

  it('differs between seeds', () => {
    const a = generateCity3D('seed-a')
    const b = generateCity3D('seed-b')
    // Obstacle counts differ because block contents are rolled per seed.
    expect(a.obstacles.size).not.toBe(b.obstacles.size)
    a.dispose()
    b.dispose()
  })

  it('provides plenty of sidewalk spots for varied rides', () => {
    expect(city.sidewalkSpots.length).toBeGreaterThan(50)
  })

  it('keeps sidewalk spots clear of every obstacle', () => {
    const found: Obstacle3D[] = []
    for (const spot of city.sidewalkSpots) {
      found.length = 0
      city.obstacles.queryRadius(spot.x, spot.z, 3, found)
      for (const ob of found) {
        if (ob.kind === 'building') {
          const inside =
            spot.x > ob.x - ob.hw &&
            spot.x < ob.x + ob.hw &&
            spot.z > ob.y - ob.hh &&
            spot.z < ob.y + ob.hh
          expect(inside).toBe(false)
        }
      }
    }
  })

  it('leaves every pickup spot reachable', () => {
    // Regression test. Street trees planted on the verge once sat exactly
    // where a car pulling up to a passenger would be, wedging it against the
    // kerb with no way out — the worst possible failure for a young player,
    // because the game had just told them to drive there.
    //
    // A car parked at a spot must not overlap any obstacle.
    const car = new Vehicle3D(city, getVehicle('taxi'))
    const found: Obstacle3D[] = []

    for (const spot of city.sidewalkSpots) {
      found.length = 0
      city.obstacles.queryRadius(spot.x, spot.z, car.bodyRadius + 2, found)

      for (const ob of found) {
        if (ob.kind === 'tree') {
          const gap = Math.hypot(spot.x - ob.x, spot.z - ob.y) - (car.bodyRadius + ob.r)
          expect(gap).toBeGreaterThan(0)
        } else {
          // Buildings are set back behind the pavement; confirm they stay there.
          const dx = Math.max(Math.abs(spot.x - ob.x) - ob.hw, 0)
          const dz = Math.max(Math.abs(spot.z - ob.y) - ob.hh, 0)
          expect(Math.hypot(dx, dz)).toBeGreaterThan(car.bodyRadius)
        }
      }
    }
  })

  it('bounds contain every sidewalk spot', () => {
    for (const spot of city.sidewalkSpots) {
      expect(spot.x).toBeGreaterThanOrEqual(city.bounds.minX)
      expect(spot.x).toBeLessThanOrEqual(city.bounds.maxX)
      expect(spot.z).toBeGreaterThanOrEqual(city.bounds.minZ)
      expect(spot.z).toBeLessThanOrEqual(city.bounds.maxZ)
    }
  })
})
