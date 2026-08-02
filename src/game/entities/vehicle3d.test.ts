/**
 * Physics tests.
 *
 * These run headlessly against a real streamed city, so they exercise the
 * actual collision index and road geometry rather than a mock. Three.js is
 * only touched for scene objects, which these tests never render — the
 * streamer builds meshes but never needs a WebGL context.
 */

import { describe, expect, it } from 'vitest'

import { getVehicle } from '../../content/vehicles.js'
import type { Obstacle3D } from '../world/drive-world.js'
import { WorldStreamer } from '../world/world-streamer.js'
import { Vehicle3D } from './vehicle3d.js'

const world = new WorldStreamer({ seed: 'physics-town', radius: 1 })
// Chunks are generated on demand, so the world is empty until something asks
// to be somewhere. Load the area the tests drive around in.
world.update(0, 0)

/** Vehicle art units per world unit, mirrored here so tests read naturally. */
const WORLD_SCALE_TEST = 1 / 12

/**
 * A patch of grass inside a block with nothing on it.
 *
 * Searched at a fine step rather than testing block centres: a block centre
 * is where the four lots meet, so it is almost always boxed in by buildings.
 * What the test needs is any point that is clear AND far enough from tarmac
 * that the car reads as off-road.
 */
function findOpenGrassSpot(): { x: number; z: number } | null {
  const b = world.roads.blockSize
  const clearance = world.roads.roadWidth / 2 + 2
  const found: Obstacle3D[] = []

  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      for (let u = 0.2; u < 0.85; u += 0.1) {
        for (let v = 0.2; v < 0.85; v += 0.1) {
          const x = (i + u) * b
          const z = (j + v) * b
          if (world.roads.nearestRoad(x, z).distance < clearance) continue
          found.length = 0
          world.obstacles.queryRadius(x, z, 3, found)
          if (found.length === 0) return { x, z }
        }
      }
    }
  }
  return null
}

function makeCar(): Vehicle3D {
  const car = new Vehicle3D(world, getVehicle('taxi'))
  // Spawn on an intersection, heading along a road.
  const b = world.roads.blockSize
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
    const reverseMax = car.def.handling.reverseSpeed * WORLD_SCALE_TEST
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(reverseMax + 1e-6)
  })

  it('is slower off-road than on it', () => {
    const onRoad = makeCar()
    onRoad.controls.throttle = 1
    step(onRoad, 4)
    expect(onRoad.onRoad).toBe(true)

    // Somewhere genuinely off the tarmac: the middle of an empty block. There
    // is no outer grass margin to use any more, since the world has no edge.
    const spot = findOpenGrassSpot()
    expect(spot).not.toBeNull()

    const offRoad = makeCar()
    offRoad.place(spot!.x, spot!.z, 0)
    offRoad.controls.throttle = 1

    // Compare peak speed while actually off-road, rather than speed at a
    // fixed time: from a block interior the car eventually reaches tarmac,
    // and the assertion is about the grass, not about where it ends up.
    let peakOffRoad = 0
    for (let i = 0; i < 240; i++) {
      offRoad.update(1 / 60)
      if (!offRoad.onRoad) peakOffRoad = Math.max(peakOffRoad, Math.abs(offRoad.speed))
    }

    expect(peakOffRoad).toBeGreaterThan(0)
    expect(peakOffRoad).toBeLessThan(Math.abs(onRoad.speed) * 0.75)
  })

  it('can drive out of the loaded area forever', () => {
    // Replaces a bounds-clamping test. The world used to end, and the car was
    // held inside it; now there is no edge to hold it at, and the streamer is
    // expected to keep building city under a car that just keeps going.
    const car = makeCar()
    car.controls.throttle = 1

    for (let i = 0; i < 60 * 30; i++) {
      car.update(1 / 60)
      // Keep the world loaded around it, exactly as the scene does.
      if (i % 30 === 0) world.update(car.x, car.z)
    }

    expect(Number.isFinite(car.x)).toBe(true)
    expect(Number.isFinite(car.z)).toBe(true)
    // It should have got somewhere well outside the block it started in.
    expect(Math.hypot(car.x, car.z)).toBeGreaterThan(world.roads.blockSize * 3)

    // And the ground under it is still a real place.
    expect(world.roads.nearestRoad(car.x, car.z).distance).toBeLessThanOrEqual(
      world.roads.blockSize / 2 + 1e-6,
    )
    world.update(0, 0)
  })

  it('never comes to rest inside an obstacle', () => {
    const car = makeCar()

    // Drive at every obstacle near the spawn and confirm none swallow the car.
    const nearby: Obstacle3D[] = []
    world.obstacles.queryRadius(car.x, car.z, 60, nearby)
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
    const b = world.roads.blockSize
    // Start off-centre and slightly off-axis, then just hold the throttle.
    car.place(b + 3, b + 1.1, 0.16)
    car.controls.throttle = 1
    step(car, 3)

    const road = world.roads.nearestRoad(car.x, car.z)
    expect(road.distance).toBeLessThan(0.2)
    expect(car.onRoad).toBe(true)
  })

  it('assist does not veer the car sideways when crossing an intersection', () => {
    // Regression test. The nearest road at a junction is the one being
    // crossed, so an ungated assist grabs the car and turns it onto the side
    // street mid-junction -- the car visibly fighting the player.
    const car = makeCar()
    const b = world.roads.blockSize
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

  it('can steer out of a building it is nosed into', () => {
    // Regression test for a hard softlock. Steering authority is proportional
    // to speed, and a head-on collision pins speed to ~0 — so holding the
    // throttle and turning could not rotate the car AT ALL. The only escape
    // was reverse, which on touch is a downward drag a 6-year-old has no way
    // to discover. The game promises no dead ends, so this has to work.
    const car = makeCar()

    const nearby: Obstacle3D[] = []
    world.obstacles.queryRadius(car.x, car.z, 60, nearby)
    const wall = nearby.find((o) => o.kind === 'building')
    expect(wall).toBeDefined()

    // Drive squarely into the middle of a wall face and hold the throttle.
    car.place(wall!.x - wall!.hw - 4, wall!.y, 0)
    car.controls.throttle = 1
    car.controls.steer = 0
    step(car, 3)

    // Confirm the setup: the car really is jammed and going nowhere.
    expect(Math.abs(car.speed)).toBeLessThan(car.maxSpeed * 0.1)
    const headingWhenStuck = car.heading

    // Now the child turns the wheel, still holding go.
    car.controls.steer = 1
    step(car, 2)

    // It must have turned enough to drive away along the wall.
    expect(Math.abs(car.heading - headingWhenStuck)).toBeGreaterThan(0.5)

    // And then actually escape.
    step(car, 3)
    expect(Math.abs(car.speed)).toBeGreaterThan(car.maxSpeed * 0.2)
  })

  it('does not let the unstick aid become spin-on-the-spot', () => {
    // The aid must only engage when genuinely wedged. In open road with no
    // obstacle, a stationary car holding full lock must still not pirouette.
    const car = makeCar()
    const before = car.heading
    car.controls.throttle = 0
    car.controls.brake = 0
    car.controls.steer = 1
    step(car, 3)
    expect(Math.abs(car.heading - before)).toBeLessThan(0.05)
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

describe('WorldStreamer', () => {
  it('is deterministic for a given seed', () => {
    const a = new WorldStreamer({ seed: 'same-seed', radius: 1 })
    const b = new WorldStreamer({ seed: 'same-seed', radius: 1 })
    a.update(0, 0)
    b.update(0, 0)
    expect(a.sidewalkSpots.length).toBe(b.sidewalkSpots.length)
    expect(a.obstacles.size).toBe(b.obstacles.size)
    a.dispose()
    b.dispose()
  })

  it('differs between seeds', () => {
    const a = new WorldStreamer({ seed: 'seed-a', radius: 1 })
    const b = new WorldStreamer({ seed: 'seed-b', radius: 1 })
    a.update(0, 0)
    b.update(0, 0)
    // Obstacle counts differ because block contents are rolled per seed.
    expect(a.obstacles.size).not.toBe(b.obstacles.size)
    a.dispose()
    b.dispose()
  })

  it('regenerates a place identically after streaming away and back', () => {
    // The property that makes an endless world feel like a place rather than
    // a treadmill: leave, come back, and it is the same street. Chunks are
    // seeded on their coordinates alone, so the route taken cannot matter.
    const w = new WorldStreamer({ seed: 'round-trip', radius: 1 })
    w.update(0, 0)
    const before = w.obstacles.size
    const spotsBefore = w.sidewalkSpots.length

    // Drive far enough that every original chunk is evicted, then return.
    w.update(4000, 4000)
    expect(w.obstacles.size).not.toBe(0)
    w.update(0, 0)

    expect(w.obstacles.size).toBe(before)
    expect(w.sidewalkSpots.length).toBe(spotsBefore)
    w.dispose()
  })

  it('builds a world wherever the player goes, however far out', () => {
    // The finite town simply had no content past its last block. Anywhere is
    // now a real place with roads, pavement and things to hit.
    const w = new WorldStreamer({ seed: 'far-away', radius: 1 })
    for (const at of [50_000, -120_000]) {
      w.update(at, -at)
      expect(w.sidewalkSpots.length).toBeGreaterThan(50)
      expect(w.obstacles.size).toBeGreaterThan(20)
    }
    w.dispose()
  })

  it('keeps every draw call count fixed as the world scrolls', () => {
    // The reason instance pools exist rather than a mesh per chunk. Whatever
    // is loaded, the renderer sees the same handful of objects.
    const w = new WorldStreamer({ seed: 'draw-calls', radius: 2 })
    w.update(0, 0)
    const count = (): number => {
      let n = 0
      w.root.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) n++
      })
      return n
    }
    const before = count()
    w.update(9000, -9000)
    expect(count()).toBe(before)
    expect(before).toBeLessThan(16)
    w.dispose()
  })

  it('shrinks and regrows the loaded world when the quality tier moves', () => {
    // Regression test. The streaming radius was read once at construction, so
    // a device that started on the high tier and was downgraded by the
    // frame-rate watchdog kept building and drawing the high-tier world for
    // the rest of the session — hundreds of thousands of triangles sitting
    // entirely behind the fog, on the one device that could least afford it.
    const w = new WorldStreamer({ seed: 'tier-change', radius: 3, maxRadius: 3 })
    w.update(0, 0)
    const atHigh = w.obstacles.size

    w.setRadius(1)
    w.update(0, 0)
    const atLow = w.obstacles.size
    expect(atLow).toBeLessThan(atHigh)

    // And back up again: the pools must have been sized for the maximum, or
    // an upgrade would silently truncate the city.
    w.setRadius(3)
    w.update(0, 0)
    expect(w.obstacles.size).toBe(atHigh)
    w.dispose()
  })

  it('never grows past the capacity its pools were built for', () => {
    const w = new WorldStreamer({ seed: 'clamped', radius: 1, maxRadius: 2 })
    w.setRadius(9)
    expect(w.radius).toBe(2)
    w.dispose()
  })

  it('provides plenty of sidewalk spots for varied rides', () => {
    expect(world.sidewalkSpots.length).toBeGreaterThan(50)
  })

  it('keeps sidewalk spots clear of every obstacle', () => {
    const found: Obstacle3D[] = []
    for (const spot of world.sidewalkSpots) {
      found.length = 0
      world.obstacles.queryRadius(spot.x, spot.z, 3, found)
      for (const ob of found) {
        if (ob.kind === 'tree') {
          expect(Math.hypot(spot.x - ob.x, spot.z - ob.y)).toBeGreaterThan(ob.r)
        } else {
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
})
