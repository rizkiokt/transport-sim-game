/**
 * Ambient traffic.
 *
 * An empty city reads as a diorama; a city with cars in it reads as a place
 * that exists whether or not you are looking. This is the cheapest large
 * gain in believability available, and it costs almost nothing because of how
 * it is built.
 *
 * **Three instanced meshes for the entire fleet.** Every traffic car shares
 * one body mesh, one cabin mesh and one wheel mesh, so twenty cars are three
 * draw calls rather than a hundred and twenty. Per-instance colour gives them
 * different paint. This is the same reasoning as the streamed city: on a
 * tablet, draw calls are the budget that actually runs out.
 *
 * **The AI is a grid walk, not navigation.** A car knows which axis it is
 * driving along, which gridline it is on, and how far along it is. At each
 * junction it rolls for straight-on, left or right. On an infinite regular
 * grid that is enough to produce traffic that looks purposeful, with no
 * pathfinding, no route storage and no possibility of getting stuck — which
 * matters, because a wedged AI car parked across a junction forever would be
 * far more noticeable than one that turns at random.
 *
 * Cars are recycled rather than created: drive far enough away and a car is
 * quietly picked up and put down again on a road ahead of you. The fleet size
 * is constant, so there is no allocation during play.
 */

import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'

import { createRng, type Rng } from '../../engine/math/rng.js'
import { cabinGeometry, roundedBoxGeometry, wheelGeometry } from '../../engine/three/geometry.js'
import type { InfiniteRoads } from '../world/infinite-roads.js'

/** Paint colours. Deliberately duller than the player's car, which is gold. */
const PAINT = [
  0x4f6d9a, 0xb04a4a, 0xd8d3c6, 0x5b8f6a, 0x7a5f96, 0xc98a3f, 0x3f5560, 0xa8b0b8,
]

/** How far to the right of the centreline a car drives, world units. */
const LANE_OFFSET = 1.35

interface TrafficCar {
  /** Which world axis the car is travelling along. */
  axis: 'x' | 'z'
  /** +1 or -1 along that axis. */
  dir: number
  /** The perpendicular gridline coordinate this car is driving on. */
  line: number
  /** Position along `axis`. */
  along: number
  speed: number
  targetSpeed: number
  colorIndex: number
  /** Accumulated wheel rotation. */
  spin: number
  /** Length and width, world units. Varied so the fleet is not uniform. */
  length: number
  width: number
  active: boolean
}

export interface TrafficOptions {
  roads: InfiniteRoads
  /** How many cars exist at once. */
  count?: number
  /** Cars are recycled beyond this distance from the player. */
  despawnRadius?: number
  seed?: number | string
}

export class TrafficSystem {
  readonly root = new Group()

  readonly #roads: InfiniteRoads
  readonly #cars: TrafficCar[] = []
  readonly #rng: Rng
  readonly #despawn: number
  /** Cars are placed back into the world between these distances. */
  readonly #spawnMin: number
  readonly #spawnMax: number

  readonly #bodyMesh: InstancedMesh
  readonly #cabinMesh: InstancedMesh
  readonly #wheelMesh: InstancedMesh
  readonly #disposables: Array<BufferGeometry | Material> = []

  readonly #matrix = new Matrix4()
  readonly #pos = new Vector3()
  readonly #quat = new Quaternion()
  readonly #scale = new Vector3()
  readonly #paint = PAINT.map((c) => new Color(c))

  constructor(options: TrafficOptions) {
    this.#roads = options.roads
    this.#rng = createRng(options.seed ?? 'traffic')
    const count = options.count ?? 16
    this.#despawn = options.despawnRadius ?? 150
    this.#spawnMin = 40
    this.#spawnMax = 120

    const bodyMat = new MeshStandardMaterial({ roughness: 0.42, metalness: 0.35 })
    const cabinMat = new MeshStandardMaterial({
      color: 0x2c3644,
      roughness: 0.22,
      metalness: 0.1,
    })
    const wheelMat = new MeshStandardMaterial({ color: 0x23232a, roughness: 0.92, metalness: 0 })
    this.#disposables.push(bodyMat, cabinMat, wheelMat)

    // Unit-sized geometry, scaled per instance. Low segment counts: these are
    // seen from a few car lengths away at most and never in close-up.
    const bodyGeo = roundedBoxGeometry(1, 1, 1, 0.18, 2)
    const cabinGeo = cabinGeometry(1, 1, 1, 0.45, 0.06, 1)
    const wheelGeo = wheelGeometry(0.5, 1, 8)
    this.#disposables.push(bodyGeo, cabinGeo, wheelGeo)

    this.#bodyMesh = new InstancedMesh(bodyGeo, bodyMat, count)
    this.#cabinMesh = new InstancedMesh(cabinGeo, cabinMat, count)
    this.#wheelMesh = new InstancedMesh(wheelGeo, wheelMat, count * 4)
    for (const mesh of [this.#bodyMesh, this.#cabinMesh, this.#wheelMesh]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      // The fleet spans the whole visible area, so a single bounding volume
      // would never cull anyway; skip the test rather than compute it.
      mesh.frustumCulled = false
      mesh.count = 0
      this.root.add(mesh)
    }

    for (let i = 0; i < count; i++) {
      this.#cars.push({
        axis: 'x',
        dir: 1,
        line: 0,
        along: 0,
        speed: 0,
        targetSpeed: 0,
        colorIndex: 0,
        spin: 0,
        length: 4,
        width: 1.8,
        active: false,
      })
    }
  }

  /** Put the whole fleet on the roads around a point. Call once at start. */
  reset(playerX: number, playerZ: number): void {
    for (const car of this.#cars) this.#respawn(car, playerX, playerZ)
  }

  /**
   * Advance every car.
   *
   * @param playerX where the player is, for recycling and for braking
   * @param playerZ
   */
  update(dt: number, playerX: number, playerZ: number): void {
    const b = this.#roads.blockSize

    for (const car of this.#cars) {
      if (!car.active) {
        this.#respawn(car, playerX, playerZ)
        continue
      }

      const { x, z } = this.#worldPosition(car)
      if (Math.hypot(x - playerX, z - playerZ) > this.#despawn) {
        this.#respawn(car, playerX, playerZ)
        continue
      }

      // -- Keep your distance ------------------------------------------------
      // Only what is directly ahead in this car's own lane matters, which on
      // a grid is a comparison of two numbers rather than a spatial query.
      car.targetSpeed = car.speed === 0 ? 3 : car.targetSpeed
      let blocked = false

      for (const other of this.#cars) {
        if (other === car || !other.active) continue
        if (other.axis !== car.axis || other.line !== car.line || other.dir !== car.dir) continue
        const gap = (other.along - car.along) * car.dir
        if (gap > 0 && gap < car.length + 2.5) blocked = true
      }

      // The player counts too — traffic that drives straight through the
      // child's car would be worse than no traffic at all.
      const ahead = this.#aheadDistance(car, playerX, playerZ)
      if (ahead !== null && ahead < car.length + 3.5) blocked = true

      car.speed += ((blocked ? 0 : car.targetSpeed) - car.speed) * Math.min(1, dt * 2.4)

      // -- Advance -----------------------------------------------------------
      const before = car.along
      car.along += car.dir * car.speed * dt
      car.spin += (car.speed * dt) / 0.34

      // -- Junctions ----------------------------------------------------------
      // Crossing a multiple of the block size is arriving at a junction.
      const beforeIndex = Math.floor(before / b)
      const afterIndex = Math.floor(car.along / b)
      if (beforeIndex !== afterIndex) {
        const junction = (car.dir > 0 ? afterIndex : beforeIndex) * b
        this.#atJunction(car, junction)
      }
    }

    this.#writeInstances()
  }

  /** How many are currently in the world. Used by the playtest. */
  get activeCount(): number {
    return this.#cars.filter((c) => c.active).length
  }

  dispose(): void {
    for (const mesh of [this.#bodyMesh, this.#cabinMesh, this.#wheelMesh]) mesh.dispose()
    for (const d of this.#disposables) d.dispose()
    this.#disposables.length = 0
    this.root.clear()
  }

  // -------------------------------------------------------------- internals

  /** Turn or carry straight on. Turning swaps which axis is which. */
  #atJunction(car: TrafficCar, junction: number): void {
    const roll = this.#rng.next()
    if (roll < 0.62) return // straight on, most of the time

    const turnRight = roll < 0.81
    const oldLine = car.line
    const oldAxis = car.axis
    const oldDir = car.dir

    // The gridline being joined is the coordinate we were travelling along;
    // the new position along it is the line we were driving on.
    car.axis = oldAxis === 'x' ? 'z' : 'x'
    car.line = junction
    car.along = oldLine

    // Which way round a turn maps to a sign depends on the axis, because the
    // two axes have opposite handedness when viewed from above.
    const sign = oldAxis === 'x' ? 1 : -1
    car.dir = turnRight ? oldDir * sign : -oldDir * sign
    if (car.dir === 0) car.dir = 1
  }

  /** Heading in radians for a car's current axis and direction. */
  #heading(car: TrafficCar): number {
    if (car.axis === 'x') return car.dir > 0 ? 0 : Math.PI
    return car.dir > 0 ? Math.PI / 2 : -Math.PI / 2
  }

  /**
   * World position, including the lane offset that keeps oncoming traffic on
   * the other side of the road.
   */
  #worldPosition(car: TrafficCar): { x: number; z: number } {
    const h = this.#heading(car)
    // Right-hand perpendicular of the travel direction.
    const rx = -Math.sin(h)
    const rz = Math.cos(h)
    if (car.axis === 'x') {
      return { x: car.along, z: car.line + rz * LANE_OFFSET }
    }
    return { x: car.line + rx * LANE_OFFSET, z: car.along }
  }

  /** How far ahead a point is in this car's lane, or null if it is not. */
  #aheadDistance(car: TrafficCar, x: number, z: number): number | null {
    const along = car.axis === 'x' ? x : z
    const across = car.axis === 'x' ? z : x
    const { x: cx, z: cz } = this.#worldPosition(car)
    const lane = car.axis === 'x' ? cz : cx
    if (Math.abs(across - lane) > 2.2) return null
    const gap = (along - car.along) * car.dir
    return gap > 0 ? gap : null
  }

  /** Place a car on a road at a plausible distance from the player. */
  #respawn(car: TrafficCar, playerX: number, playerZ: number): void {
    const rng = this.#rng
    const b = this.#roads.blockSize

    // Somewhere in a ring around the player: far enough not to pop into view
    // in front of them, near enough to be seen soon.
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(this.#spawnMin, this.#spawnMax)
    const tx = playerX + Math.cos(angle) * distance
    const tz = playerZ + Math.sin(angle) * distance

    // Snap onto the nearest gridline so the car starts on tarmac.
    const hit = this.#roads.nearestRoad(tx, tz)
    if (hit.horizontal) {
      car.axis = 'x'
      car.line = hit.z
      car.along = tx
    } else {
      car.axis = 'z'
      car.line = hit.x
      car.along = tz
    }

    car.dir = rng.chance(0.5) ? 1 : -1
    car.length = rng.range(3.5, 4.8)
    car.width = rng.range(1.6, 2.0)
    car.colorIndex = rng.int(0, PAINT.length - 1)
    car.targetSpeed = rng.range(4.5, 7.5)
    car.speed = car.targetSpeed
    car.spin = 0
    car.active = true

    // Never drop a car on top of the player.
    const { x, z } = this.#worldPosition(car)
    if (Math.hypot(x - playerX, z - playerZ) < 18) {
      car.along += car.dir * b
    }
  }

  /** Write the whole fleet into the three instance buffers. */
  #writeInstances(): void {
    let n = 0
    let w = 0

    for (const car of this.#cars) {
      if (!car.active) continue
      const { x, z } = this.#worldPosition(car)
      const h = this.#heading(car)
      // A mesh built facing +X needs -heading about Y.
      this.#quat.setFromAxisAngle(AXIS_Y, -h)

      const bodyHeight = car.width * 0.62
      const wheelRadius = car.length * 0.1

      this.#pos.set(x, wheelRadius + bodyHeight / 2, z)
      this.#scale.set(car.length, bodyHeight, car.width)
      this.#matrix.compose(this.#pos, this.#quat, this.#scale)
      this.#bodyMesh.setMatrixAt(n, this.#matrix)
      this.#bodyMesh.setColorAt(n, this.#paint[car.colorIndex]!)

      this.#pos.set(x, wheelRadius + bodyHeight + car.width * 0.24, z)
      this.#scale.set(car.length * 0.52, car.width * 0.48, car.width * 0.86)
      this.#matrix.compose(this.#pos, this.#quat, this.#scale)
      this.#cabinMesh.setMatrixAt(n, this.#matrix)
      n++

      // Four wheels, spun by distance travelled. The wheel mesh is built with
      // its axle along Z, matching the player car's geometry.
      const dx = Math.cos(h)
      const dz = Math.sin(h)
      const rx = -Math.sin(h)
      const rz = Math.cos(h)
      const axleFront = car.length * 0.31
      const axleSide = car.width * 0.5

      for (const front of [1, -1]) {
        for (const side of [1, -1]) {
          this.#pos.set(
            x + dx * axleFront * front + rx * axleSide * side,
            wheelRadius,
            z + dz * axleFront * front + rz * axleSide * side,
          )
          this.#quat.setFromAxisAngle(AXIS_Y, -h)
          this.#spinQuat.setFromAxisAngle(AXIS_Z, -car.spin)
          this.#quat.multiply(this.#spinQuat)
          this.#scale.set(wheelRadius * 2, wheelRadius * 2, car.width * 0.16)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#wheelMesh.setMatrixAt(w++, this.#matrix)
        }
      }
    }

    this.#bodyMesh.count = n
    this.#cabinMesh.count = n
    this.#wheelMesh.count = w
    this.#bodyMesh.instanceMatrix.needsUpdate = true
    this.#cabinMesh.instanceMatrix.needsUpdate = true
    this.#wheelMesh.instanceMatrix.needsUpdate = true
    if (this.#bodyMesh.instanceColor) this.#bodyMesh.instanceColor.needsUpdate = true
  }

  readonly #spinQuat = new Quaternion()
}

const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)
