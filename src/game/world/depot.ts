/**
 * The transport depot: home base for the company.
 *
 * An endless city has no landmarks by construction — every junction looks
 * like every other junction, and "drive around forever" is not a game. The
 * depot is the fixed point that makes the world navigable: it is always at
 * the same coordinates, always on the map, and fast travel always brings you
 * back to it. Everything the player owns lives here.
 *
 * It does three jobs:
 *
 * - **A place.** A big open-fronted shed on its own block, with the fleet
 *   parked in its bays. Walking or driving inside opens the garage, so
 *   swapping cars is something you do somewhere rather than through a menu.
 * - **An anchor.** Fast travel returns here from anywhere, which is what
 *   stops an infinite map from being a way to get lost.
 * - **A show of progress.** The bays fill up as cars are bought. A six-year-
 *   old who owns four cars can drive to a building and see four cars in it,
 *   which a number on a screen does not do.
 */

import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three'

import { getVehicle, VEHICLES } from '../../content/vehicles.js'
import { createCar, createCarMaterials, disposeCar, disposeCarMaterials, type CarParts, type CarSharedMaterials } from '../art/car-model.js'
import type { Obstacle3D } from './drive-world.js'

/** Which city block the depot occupies. Chosen next to the world origin. */
export const DEPOT_BLOCK_X = 0
export const DEPOT_BLOCK_Z = 0

/** How close you have to be for the depot to open its doors, world units. */
export const DEPOT_RADIUS = 7.5

export interface DepotOptions {
  /** Centre of the depot block, world units. */
  x: number
  z: number
  blockSize: number
  /** Bay count. Enough for the whole catalogue. */
  bays?: number
}

export class Depot {
  readonly root = new Group()
  readonly x: number
  readonly z: number

  /** Solid parts, handed to the world so cars cannot drive through walls. */
  readonly obstacles: Obstacle3D[] = []

  /**
   * Where a car sits when parked in each bay, and where fast travel drops
   * you: on the forecourt, facing out, never inside a wall.
   */
  readonly bayPositions: Array<{ x: number; z: number; heading: number }> = []
  readonly arrivalX: number
  readonly arrivalZ: number
  readonly arrivalHeading: number

  readonly #disposables: Array<BufferGeometry | Material> = []
  readonly #carMaterials: CarSharedMaterials
  readonly #parked = new Map<string, CarParts>()
  readonly #bayGroup = new Group()

  constructor(options: DepotOptions) {
    this.x = options.x
    this.z = options.z
    const bays = options.bays ?? VEHICLES.length

    const width = options.blockSize * 0.72
    const depth = options.blockSize * 0.42
    const height = 5.4

    this.root.position.set(this.x, 0, this.z)
    this.root.add(this.#bayGroup)

    // -- Materials ---------------------------------------------------------
    const wallMat = new MeshStandardMaterial({ color: 0xe8e0cd, roughness: 0.85, metalness: 0.02 })
    const trimMat = new MeshStandardMaterial({ color: 0x3f6fa8, roughness: 0.6, metalness: 0.1 })
    const floorMat = new MeshStandardMaterial({ color: 0xb9b4a6, roughness: 0.95, metalness: 0 })
    const signMat = new MeshStandardMaterial({
      color: 0xffc93c,
      roughness: 0.45,
      metalness: 0.05,
      emissive: new Color(0x6b4c00),
      emissiveIntensity: 0.4,
    })
    this.#disposables.push(wallMat, trimMat, floorMat, signMat)

    const box = (
      w: number,
      h: number,
      d: number,
      px: number,
      py: number,
      pz: number,
      mat: MeshStandardMaterial,
    ): Mesh => {
      const geo = new BoxGeometry(w, h, d)
      this.#disposables.push(geo)
      const mesh = new Mesh(geo, mat)
      mesh.position.set(px, py, pz)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.root.add(mesh)
      return mesh
    }

    // -- Forecourt ----------------------------------------------------------
    // A concrete apron in front, so the depot reads as a place with an
    // entrance rather than a shed dropped on grass. Sized to stop at the
    // block edge — any longer and it would pave over the pavement and road.
    const apron = box(width + 4, 0.14, depth + 6, 0, 0.07, depth * 0.35, floorMat)
    apron.castShadow = false

    // -- Shed ---------------------------------------------------------------
    // Open along +Z: three walls and a roof, so you can see the fleet inside
    // from the street and drive straight in.
    const wallT = 0.5
    box(width, height, wallT, 0, height / 2, -depth / 2, wallMat)
    box(wallT, height, depth, -width / 2, height / 2, 0, wallMat)
    box(wallT, height, depth, width / 2, height / 2, 0, wallMat)

    // Roof, overhanging on all sides.
    box(width + 1.2, 0.55, depth + 1.2, 0, height + 0.2, 0, trimMat)
    // A valance across the open front, so the opening reads as a doorway.
    box(width, 1.1, 0.6, 0, height - 0.55, depth / 2, trimMat)

    // Floor slab inside.
    const floor = box(width - wallT, 0.1, depth, 0, 0.05, 0, floorMat)
    floor.castShadow = false

    // -- Sign ----------------------------------------------------------------
    box(width * 0.5, 1.5, 0.35, 0, height + 1.3, -depth / 2 + 0.1, signMat)

    // -- Bays ------------------------------------------------------------------
    // Evenly spaced across the shed, each car facing out of the opening.
    const usable = width - 2.4
    for (let i = 0; i < bays; i++) {
      const t = bays === 1 ? 0.5 : (i + 0.5) / bays
      const bx = -usable / 2 + usable * t
      this.bayPositions.push({
        x: this.x + bx,
        z: this.z - depth * 0.1,
        // Facing +Z, out through the opening. Heading 0 faces +X.
        heading: Math.PI / 2,
      })

      // A painted stripe marking each bay.
      const stripe = box(0.12, 0.02, depth * 0.8, bx - usable / (bays * 2), 0.12, 0, trimMat)
      stripe.castShadow = false
    }

    // -- Where you arrive ---------------------------------------------------
    // On the street outside the opening, facing along the road. Never inside
    // the shed: arriving nose-to-wall in a car you cannot see out of is a
    // rotten way to land, and landing on tarmac means the road assist has
    // something to work with the instant you touch the throttle.
    this.arrivalX = this.x
    this.arrivalZ = this.z + options.blockSize / 2
    this.arrivalHeading = 0

    // -- Collision -----------------------------------------------------------
    // The three walls only. The opening is deliberately passable — driving
    // into your own garage is the point.
    this.obstacles.push(
      { x: this.x, y: this.z - depth / 2, kind: 'prop', hw: width / 2, hh: wallT, r: 0 },
      { x: this.x - width / 2, y: this.z, kind: 'prop', hw: wallT, hh: depth / 2, r: 0 },
      { x: this.x + width / 2, y: this.z, kind: 'prop', hw: wallT, hh: depth / 2, r: 0 },
    )

    this.#carMaterials = createCarMaterials()
  }

  /** True when a position is inside the depot's trigger. */
  contains(x: number, z: number): boolean {
    return Math.hypot(x - this.x, z - this.z) < DEPOT_RADIUS
  }

  /**
   * Park the owned fleet in the bays, leaving out whichever car is currently
   * being driven — it is not in the garage, it is out on the road.
   */
  setFleet(owned: readonly string[], activeId: string): void {
    const shown = owned.filter((id) => id !== activeId)

    // Drop anything no longer parked here.
    for (const [id, parts] of this.#parked) {
      if (shown.includes(id)) continue
      this.#bayGroup.remove(parts.root)
      disposeCar(parts)
      this.#parked.delete(id)
    }

    shown.forEach((id, index) => {
      const bay = this.bayPositions[index]
      if (!bay) return

      let parts = this.#parked.get(id)
      if (!parts) {
        const def = getVehicle(id)
        parts = createCar({ art: def.art, paint: def.paint }, this.#carMaterials)
        this.#parked.set(id, parts)
        this.#bayGroup.add(parts.root)
      }

      // Bay positions are world-space; the group is a child of the depot root,
      // which is already translated, so subtract it back out.
      parts.root.position.set(bay.x - this.x, 0, bay.z - this.z)
      parts.root.rotation.y = -bay.heading
    })
  }

  dispose(): void {
    for (const parts of this.#parked.values()) disposeCar(parts)
    this.#parked.clear()
    disposeCarMaterials(this.#carMaterials)
    for (const d of this.#disposables) d.dispose()
    this.#disposables.length = 0
    this.root.clear()
  }
}
