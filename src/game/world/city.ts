/**
 * Procedural town generation.
 *
 * Everything is derived from one seed, so the same town greets the child
 * every session — familiarity is comfort at this age. The generator fills
 * the blocks between roads with building lots, parks, and trees, and
 * precomputes the obstacle index used by driving collision.
 */

import { createRng } from '../../engine/math/rng.js'
import { vary, type Rgba } from '../../engine/render/color.js'
import { SpatialHash } from '../../engine/spatial/spatial-hash.js'
import { PALETTE } from '../config/palette.js'
import { RoadNetwork } from './road-network.js'

export interface Building {
  /** AABB in world space. */
  x: number
  y: number
  w: number
  h: number
  roofColor: Rgba
  trimColor: Rgba
  /** 0..1 unit value that picks roof decoration. */
  detail: number
}

export interface Tree {
  x: number
  y: number
  /** Foliage radius. */
  r: number
  /** Phase offset so the whole town doesn't sway in unison. */
  phase: number
  foliage: Rgba
}

export interface ParkBlock {
  x: number
  y: number
  w: number
  h: number
}

/** One entry in the collision index: either a building AABB or a tree circle. */
export interface Obstacle {
  /** Centre, for the spatial hash. */
  x: number
  y: number
  kind: 'building' | 'tree'
  /** Building half-extents. */
  hw: number
  hh: number
  /** Tree radius. */
  r: number
}

export interface City {
  roads: RoadNetwork
  buildings: readonly Building[]
  trees: readonly Tree[]
  parks: readonly ParkBlock[]
  /** Where passengers may stand. */
  sidewalkSpots: ReadonlyArray<{ x: number; y: number }>
  obstacles: SpatialHash<Obstacle>
  /** Drivable-world bounds, with a small margin beyond the outer roads. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface CityOptions {
  seed: number | string
  cols?: number
  rows?: number
  blockSize?: number
}

const ROAD_WIDTH = 64
const PAVED_WIDTH = 96

const BUILDING_FAMILIES: readonly { wall: Rgba; roof: Rgba }[] = [
  { wall: PALETTE.buildingBrick, roof: PALETTE.roofWarm },
  { wall: PALETTE.buildingCream, roof: PALETTE.roofPale },
  { wall: PALETTE.buildingTeal, roof: PALETTE.roofCool },
  { wall: PALETTE.buildingBlue, roof: PALETTE.roofCool },
  { wall: PALETTE.buildingCoral, roof: PALETTE.roofWarm },
]

export function generateCity(options: CityOptions): City {
  const cols = options.cols ?? 8
  const rows = options.rows ?? 6
  const blockSize = options.blockSize ?? 260

  const roads = new RoadNetwork({
    cols,
    rows,
    blockSize,
    roadWidth: ROAD_WIDTH,
    pavedWidth: PAVED_WIDTH,
  })

  const rng = createRng(options.seed).fork('city')
  const buildings: Building[] = []
  const trees: Tree[] = []
  const parks: ParkBlock[] = []

  // The buildable interior of each block: inset from the road centrelines by
  // half the paved width plus a grass margin, so lawns separate walls from
  // sidewalks and the car has room to squeeze past if it wanders off-road.
  const inset = PAVED_WIDTH / 2 + 14
  const interior = blockSize - inset * 2

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const blockRng = rng.fork(`block:${col}:${row}`)
      const x0 = col * blockSize + inset
      const y0 = row * blockSize + inset

      if (blockRng.chance(0.22)) {
        // A park block: open grass with a cluster of trees.
        parks.push({ x: x0, y: y0, w: interior, h: interior })
        const treeCount = blockRng.int(4, 7)
        for (let i = 0; i < treeCount; i++) {
          trees.push(makeTree(blockRng, x0 + blockRng.range(20, interior - 20), y0 + blockRng.range(20, interior - 20)))
        }
        continue
      }

      // A built block: a 2x2 grid of lots, each a building or a tree corner.
      const lot = interior / 2
      for (let ly = 0; ly < 2; ly++) {
        for (let lx = 0; lx < 2; lx++) {
          const lotX = x0 + lx * lot
          const lotY = y0 + ly * lot

          if (blockRng.chance(0.78)) {
            const family = blockRng.pick(BUILDING_FAMILIES)
            const variation = blockRng.next()
            const w = blockRng.range(lot * 0.55, lot * 0.82)
            const h = blockRng.range(lot * 0.55, lot * 0.82)
            buildings.push({
              x: lotX + blockRng.range(4, lot - w - 4),
              y: lotY + blockRng.range(4, lot - h - 4),
              w,
              h,
              roofColor: vary(family.roof, variation, 10, 0.06),
              trimColor: vary(family.wall, variation, 8, 0.05),
              detail: blockRng.next(),
            })
          } else {
            // A green corner with one or two trees.
            const treeCount = blockRng.int(1, 2)
            for (let i = 0; i < treeCount; i++) {
              trees.push(
                makeTree(
                  blockRng,
                  lotX + blockRng.range(18, lot - 18),
                  lotY + blockRng.range(18, lot - 18),
                ),
              )
            }
          }
        }
      }
    }
  }

  // Collision index. Cell size ~2 car lengths keeps queries to a few buckets.
  const obstacles = new SpatialHash<Obstacle>(128)
  for (const b of buildings) {
    obstacles.insert({
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      kind: 'building',
      hw: b.w / 2,
      hh: b.h / 2,
      r: 0,
    })
  }
  for (const t of trees) {
    obstacles.insert({ x: t.x, y: t.y, kind: 'tree', hw: 0, hh: 0, r: t.r * 0.45 })
  }

  const margin = PAVED_WIDTH
  return {
    roads,
    buildings,
    trees,
    parks,
    sidewalkSpots: roads.buildSidewalkSpots(110),
    obstacles,
    bounds: {
      minX: roads.minX - margin,
      minY: roads.minY - margin,
      maxX: roads.maxX + margin,
      maxY: roads.maxY + margin,
    },
  }
}

function makeTree(rng: ReturnType<typeof createRng>, x: number, y: number): Tree {
  return {
    x,
    y,
    r: rng.range(11, 17),
    phase: rng.range(0, Math.PI * 2),
    foliage: rng.chance(0.35) ? PALETTE.treeFoliageLight : PALETTE.treeFoliage,
  }
}
