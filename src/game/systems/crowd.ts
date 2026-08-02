/**
 * People on the pavements.
 *
 * The ride system already puts one detailed character on screen — the
 * passenger you are collecting — and that one is worth its cost. These are
 * the other thirty, and they need to cost almost nothing each.
 *
 * So a pedestrian here is six instances rather than six meshes: body, head,
 * two legs, two arms, all drawn from shared instanced meshes. Thirty people
 * cost five draw calls. Limbs are animated by rewriting their instance
 * matrices each frame, which for a few hundred matrices is far cheaper than
 * a skinned mesh and reads perfectly well at the distance you see them from.
 *
 * They walk the pavements in straight lines and turn at corners, following
 * the same grid-walk idea as the traffic. Nobody needs to path-find to look
 * like they are going somewhere.
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
import { capsuleGeometry, headGeometry } from '../../engine/three/geometry.js'
import type { InfiniteRoads } from '../world/infinite-roads.js'

const SHIRT_COLORS = [
  0xe4573f, 0x3f7fc4, 0x4aa564, 0xd7a13b, 0x8b5fbf, 0xd8687f, 0x3fa8a0, 0xe0e0d4,
]
const SKIN_COLORS = [0xf2c9a0, 0xd9a173, 0xa9713f, 0x7a4a26, 0xf7ddc0, 0x5c3418]
const TROUSER_COLORS = [0x3a4256, 0x5a4636, 0x2f3f34, 0x60606a]

/** Scale factor applied to a nominal 1.7m adult. */
const BASE_HEIGHT = 1.7

interface Pedestrian {
  x: number
  z: number
  /** Radians; 0 faces +X. Always axis-aligned along a pavement. */
  heading: number
  speed: number
  /** Walk cycle phase, radians. */
  phase: number
  height: number
  shirt: number
  skin: number
  trousers: number
  active: boolean
}

export interface CrowdOptions {
  roads: InfiniteRoads
  count?: number
  despawnRadius?: number
  seed?: number | string
}

export class Crowd {
  readonly root = new Group()

  readonly #roads: InfiniteRoads
  readonly #people: Pedestrian[] = []
  readonly #rng: Rng
  readonly #despawn: number

  readonly #bodyMesh: InstancedMesh
  readonly #headMesh: InstancedMesh
  readonly #legMesh: InstancedMesh
  readonly #armMesh: InstancedMesh
  readonly #disposables: Array<BufferGeometry | Material> = []

  readonly #matrix = new Matrix4()
  readonly #pos = new Vector3()
  readonly #quat = new Quaternion()
  readonly #limbQuat = new Quaternion()
  readonly #scale = new Vector3()
  readonly #forward = new Vector3()
  readonly #side = new Vector3()

  readonly #shirtColors = SHIRT_COLORS.map((c) => new Color(c))
  readonly #skinColors = SKIN_COLORS.map((c) => new Color(c))
  readonly #trouserColors = TROUSER_COLORS.map((c) => new Color(c))

  constructor(options: CrowdOptions) {
    this.#roads = options.roads
    this.#rng = createRng(options.seed ?? 'crowd')
    const count = options.count ?? 28
    this.#despawn = options.despawnRadius ?? 90

    const skinMat = new MeshStandardMaterial({ roughness: 0.78, metalness: 0 })
    const shirtMat = new MeshStandardMaterial({ roughness: 0.88, metalness: 0 })
    const trouserMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
    this.#disposables.push(skinMat, shirtMat, trouserMat)

    // Unit geometry, scaled per instance. Segment counts are low because a
    // pedestrian is a few dozen pixels tall for most of their life on screen.
    const bodyGeo = capsuleGeometry(0.5, 1, 4)
    const headGeo = headGeometry(0.5, 0.92, 8)
    const limbGeo = capsuleGeometry(0.5, 1.4, 3)
    this.#disposables.push(bodyGeo, headGeo, limbGeo)

    const make = (geo: BufferGeometry, mat: Material, n: number): InstancedMesh => {
      const mesh = new InstancedMesh(geo, mat, n)
      mesh.castShadow = true
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      mesh.count = 0
      this.root.add(mesh)
      return mesh
    }

    this.#bodyMesh = make(bodyGeo, shirtMat, count)
    this.#headMesh = make(headGeo, skinMat, count)
    this.#legMesh = make(limbGeo, trouserMat, count * 2)
    this.#armMesh = make(limbGeo, skinMat, count * 2)

    for (let i = 0; i < count; i++) {
      this.#people.push({
        x: 0,
        z: 0,
        heading: 0,
        speed: 1.2,
        phase: 0,
        height: BASE_HEIGHT,
        shirt: 0,
        skin: 0,
        trousers: 0,
        active: false,
      })
    }
  }

  /** Populate the pavements around a point. */
  reset(playerX: number, playerZ: number): void {
    for (const person of this.#people) this.#respawn(person, playerX, playerZ)
  }

  update(dt: number, playerX: number, playerZ: number): void {
    for (const person of this.#people) {
      if (!person.active) {
        this.#respawn(person, playerX, playerZ)
        continue
      }

      if (Math.hypot(person.x - playerX, person.z - playerZ) > this.#despawn) {
        this.#respawn(person, playerX, playerZ)
        continue
      }

      person.x += Math.cos(person.heading) * person.speed * dt
      person.z += Math.sin(person.heading) * person.speed * dt
      // Stride length scales with speed, so a fast walker's legs keep up.
      person.phase += (person.speed / (person.height * 0.42)) * dt * 2

      // Turn the corner rather than walk off the kerb into the road.
      if (!this.#roads.isOnPavement(person.x, person.z)) {
        this.#turnBackOntoPavement(person)
      }
    }

    this.#writeInstances()
  }

  /** How many are currently in the world. Used by the playtest. */
  get activeCount(): number {
    return this.#people.filter((c) => c.active).length
  }

  dispose(): void {
    for (const mesh of [this.#bodyMesh, this.#headMesh, this.#legMesh, this.#armMesh]) {
      mesh.dispose()
    }
    for (const d of this.#disposables) d.dispose()
    this.#disposables.length = 0
    this.root.clear()
  }

  // -------------------------------------------------------------- internals

  /**
   * Step back and pick a new direction along the pavement.
   *
   * The pavement is a cross-shaped band around every gridline, so at a corner
   * a walker can continue on the road they are on or join the crossing one.
   * Trying the four axis directions and taking the first that stays on
   * pavement is both simpler and more robust than reasoning about which
   * corner this is.
   */
  #turnBackOntoPavement(person: Pedestrian): void {
    // Undo the step that took them off.
    person.x -= Math.cos(person.heading) * 0.4
    person.z -= Math.sin(person.heading) * 0.4

    const options: number[] = []
    for (let i = 0; i < 4; i++) {
      const h = (i * Math.PI) / 2
      const probe = 1.2
      if (this.#roads.isOnPavement(person.x + Math.cos(h) * probe, person.z + Math.sin(h) * probe)) {
        options.push(h)
      }
    }

    if (options.length === 0) {
      // Boxed in — nudge back toward the nearest pavement and carry on.
      const hit = this.#roads.nearestRoad(person.x, person.z)
      person.heading = Math.atan2(hit.z - person.z, hit.x - person.x)
      return
    }

    person.heading = options[this.#rng.int(0, options.length - 1)]!
  }

  #respawn(person: Pedestrian, playerX: number, playerZ: number): void {
    const rng = this.#rng
    const angle = rng.range(0, Math.PI * 2)
    const distance = rng.range(20, this.#despawn * 0.8)
    const tx = playerX + Math.cos(angle) * distance
    const tz = playerZ + Math.sin(angle) * distance

    // Stand on the footway: out past the asphalt, inside the paved band.
    const hit = this.#roads.nearestRoad(tx, tz)
    const offset =
      (this.#roads.roadWidth / 2 + this.#roads.pavedWidth / 2) / 2 * (rng.chance(0.5) ? 1 : -1)

    if (hit.horizontal) {
      person.x = tx
      person.z = hit.z + offset
      person.heading = rng.chance(0.5) ? 0 : Math.PI
    } else {
      person.x = hit.x + offset
      person.z = tz
      person.heading = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2
    }

    person.speed = rng.range(0.85, 1.6)
    person.height = BASE_HEIGHT * rng.range(0.62, 1.06)
    person.phase = rng.range(0, Math.PI * 2)
    person.shirt = rng.int(0, SHIRT_COLORS.length - 1)
    person.skin = rng.int(0, SKIN_COLORS.length - 1)
    person.trousers = rng.int(0, TROUSER_COLORS.length - 1)
    person.active = true
  }

  #writeInstances(): void {
    let n = 0
    let limb = 0

    for (const person of this.#people) {
      if (!person.active) continue

      const h = person.height
      const legLength = h * 0.44
      const bodyHeight = h * 0.36
      const bodyY = legLength + bodyHeight / 2
      const headY = legLength + bodyHeight + h * 0.1

      // A mesh built facing +X needs -heading about Y.
      this.#quat.setFromAxisAngle(AXIS_Y, -person.heading)

      this.#pos.set(person.x, bodyY, person.z)
      this.#scale.set(h * 0.34, bodyHeight, h * 0.22)
      this.#matrix.compose(this.#pos, this.#quat, this.#scale)
      this.#bodyMesh.setMatrixAt(n, this.#matrix)
      this.#bodyMesh.setColorAt(n, this.#shirtColors[person.shirt]!)

      this.#pos.set(person.x, headY, person.z)
      this.#scale.setScalar(h * 0.23)
      this.#matrix.compose(this.#pos, this.#quat, this.#scale)
      this.#headMesh.setMatrixAt(n, this.#matrix)
      this.#headMesh.setColorAt(n, this.#skinColors[person.skin]!)
      n++

      // Limbs swing in antiphase, arms opposing legs — the thing that makes a
      // walk read as a walk rather than a slide.
      const swing = Math.sin(person.phase) * 0.5
      // Scratch, not fresh vectors: this runs for every limb of every person
      // every frame, and allocating here would hand the GC a steady drip of
      // garbage for no reason.
      const forward = this.#forward.set(Math.cos(person.heading), 0, Math.sin(person.heading))
      const side = this.#side.set(-Math.sin(person.heading), 0, Math.cos(person.heading))

      for (const [index, sign] of [
        [0, 1],
        [1, -1],
      ] as Array<[number, number]>) {
        const angle = swing * sign
        // Pivot at the hip: the limb hangs down and swings about its top.
        const hipY = legLength
        const halfLeg = legLength / 2
        const offX = side.x * h * 0.09 * (index === 0 ? 1 : -1)
        const offZ = side.z * h * 0.09 * (index === 0 ? 1 : -1)

        this.#pos.set(
          person.x + offX + forward.x * Math.sin(angle) * halfLeg,
          hipY - Math.cos(angle) * halfLeg,
          person.z + offZ + forward.z * Math.sin(angle) * halfLeg,
        )
        this.#limbQuat.setFromAxisAngle(AXIS_Z, angle)
        this.#quat.setFromAxisAngle(AXIS_Y, -person.heading)
        this.#quat.multiply(this.#limbQuat)
        this.#scale.set(h * 0.1, legLength, h * 0.1)
        this.#matrix.compose(this.#pos, this.#quat, this.#scale)
        this.#legMesh.setMatrixAt(limb, this.#matrix)
        this.#legMesh.setColorAt(limb, this.#trouserColors[person.trousers]!)

        // Arms: same swing, opposite sign, hung from the shoulder.
        const armAngle = -angle
        const shoulderY = legLength + bodyHeight * 0.92
        const armLength = h * 0.3
        const halfArm = armLength / 2
        const armOffX = side.x * h * 0.19 * (index === 0 ? 1 : -1)
        const armOffZ = side.z * h * 0.19 * (index === 0 ? 1 : -1)

        this.#pos.set(
          person.x + armOffX + forward.x * Math.sin(armAngle) * halfArm,
          shoulderY - Math.cos(armAngle) * halfArm,
          person.z + armOffZ + forward.z * Math.sin(armAngle) * halfArm,
        )
        this.#limbQuat.setFromAxisAngle(AXIS_Z, armAngle)
        this.#quat.setFromAxisAngle(AXIS_Y, -person.heading)
        this.#quat.multiply(this.#limbQuat)
        this.#scale.set(h * 0.075, armLength, h * 0.075)
        this.#matrix.compose(this.#pos, this.#quat, this.#scale)
        this.#armMesh.setMatrixAt(limb, this.#matrix)
        this.#armMesh.setColorAt(limb, this.#skinColors[person.skin]!)

        limb++
      }
    }

    this.#bodyMesh.count = n
    this.#headMesh.count = n
    this.#legMesh.count = limb
    this.#armMesh.count = limb
    for (const mesh of [this.#bodyMesh, this.#headMesh, this.#legMesh, this.#armMesh]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }
}

const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)
