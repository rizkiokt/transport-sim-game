/**
 * The slice of the world that anything driveable needs.
 *
 * Vehicles used to take the whole concrete city object, which meant the car
 * could not exist without the specific world it was written against. Once the
 * city became endless and streamed, that coupling had to go: the car needs
 * exactly two questions answered — "where is the road?" and "what am I about
 * to hit?" — and nothing else.
 *
 * Keeping this deliberately small is also what lets AI traffic reuse the
 * player's physics against the same world, and what lets tests drive a car
 * around a stub world with no meshes in it at all.
 */

import type { SpatialHash } from '../../engine/spatial/spatial-hash.js'
import type { RoadHit } from './infinite-roads.js'

/**
 * How many world units one unit of vehicle art is.
 *
 * Vehicle dimensions are authored in a 2D layout space inherited from the
 * original top-down build; this is the single conversion into metres.
 */
export const WORLD_SCALE = 1 / 12

/** Something solid on the ground plane. Named x/y because SpatialHash is 2D. */
export interface Obstacle3D {
  x: number
  y: number
  kind: 'building' | 'tree' | 'prop'
  /** Half-extents for box obstacles. */
  hw: number
  hh: number
  /** Radius for round obstacles. Zero means "use the box". */
  r: number
}

/** The road queries a driver needs. Satisfied by {@link InfiniteRoads}. */
export interface RoadQuery {
  nearestRoad(x: number, z: number, out?: RoadHit): RoadHit
  readonly roadWidth: number
  readonly blockSize: number
}

export interface DriveWorld {
  readonly roads: RoadQuery
  readonly obstacles: SpatialHash<Obstacle3D>
}
