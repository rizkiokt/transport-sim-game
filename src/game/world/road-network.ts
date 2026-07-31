/**
 * The town's road network: a grid of intersections joined by straight
 * segments.
 *
 * A full grid (every neighbouring intersection connected) is deliberately
 * chosen for the first town: there are no dead ends, every block is
 * circumnavigable, and a lost 6-year-old can always turn any direction and
 * find their way. More organic layouts can come later as new districts.
 *
 * Everything here is geometry queries; the network never mutates after
 * construction, so results are safe to cache.
 */

export interface RoadPoint {
  /** Closest point on the road centreline. */
  x: number
  y: number
  /** Direction of the road at that point, radians. The opposite direction is equally valid. */
  tangent: number
  /** Distance from the query point to the centreline. */
  distance: number
  /** Index of the segment in {@link RoadNetwork.segments}. */
  segmentIndex: number
}

export interface RoadSegment {
  ax: number
  ay: number
  bx: number
  by: number
  /** Precomputed direction, radians. */
  angle: number
  /** Precomputed length. */
  length: number
  horizontal: boolean
}

export interface RoadNetworkOptions {
  /** Number of intersection columns. */
  cols: number
  /** Number of intersection rows. */
  rows: number
  /** Distance between intersections, world units. */
  blockSize: number
  /** Asphalt width. */
  roadWidth: number
  /** Total paved width including sidewalks. */
  pavedWidth: number
}

export class RoadNetwork {
  readonly cols: number
  readonly rows: number
  readonly blockSize: number
  readonly roadWidth: number
  readonly pavedWidth: number

  readonly segments: readonly RoadSegment[]

  /** World-space bounds of the whole network (centrelines, not pavement). */
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number

  constructor(options: RoadNetworkOptions) {
    this.cols = options.cols
    this.rows = options.rows
    this.blockSize = options.blockSize
    this.roadWidth = options.roadWidth
    this.pavedWidth = options.pavedWidth

    this.minX = 0
    this.minY = 0
    this.maxX = (options.cols - 1) * options.blockSize
    this.maxY = (options.rows - 1) * options.blockSize

    const segments: RoadSegment[] = []
    const B = options.blockSize

    // Horizontal segments.
    for (let row = 0; row < options.rows; row++) {
      for (let col = 0; col < options.cols - 1; col++) {
        segments.push({
          ax: col * B,
          ay: row * B,
          bx: (col + 1) * B,
          by: row * B,
          angle: 0,
          length: B,
          horizontal: true,
        })
      }
    }

    // Vertical segments.
    for (let row = 0; row < options.rows - 1; row++) {
      for (let col = 0; col < options.cols; col++) {
        segments.push({
          ax: col * B,
          ay: row * B,
          bx: col * B,
          by: (row + 1) * B,
          angle: Math.PI / 2,
          length: B,
          horizontal: false,
        })
      }
    }

    this.segments = segments
  }

  /**
   * Closest point on any road centreline.
   *
   * Axis-aligned segments make this cheap: the closest point on a horizontal
   * segment is a clamp in x, so each candidate costs a few comparisons. The
   * network is small (~100 segments) and only the player queries per step,
   * so a straight scan beats maintaining an index.
   */
  nearestRoad(x: number, y: number, out?: RoadPoint): RoadPoint {
    const result: RoadPoint = out ?? {
      x: 0,
      y: 0,
      tangent: 0,
      distance: Infinity,
      segmentIndex: -1,
    }
    result.distance = Infinity
    result.segmentIndex = -1

    let bestDistSq = Infinity

    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i]!

      let px: number
      let py: number
      if (s.horizontal) {
        px = x < s.ax ? s.ax : x > s.bx ? s.bx : x
        py = s.ay
      } else {
        px = s.ax
        py = y < s.ay ? s.ay : y > s.by ? s.by : y
      }

      const dx = x - px
      const dy = y - py
      const distSq = dx * dx + dy * dy
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        result.x = px
        result.y = py
        result.tangent = s.angle
        result.segmentIndex = i
      }
    }

    result.distance = Math.sqrt(bestDistSq)
    return result
  }

  /** Is this point on the asphalt (not counting sidewalks)? */
  isOnRoad(x: number, y: number): boolean {
    return this.nearestRoad(x, y, SCRATCH).distance <= this.roadWidth / 2
  }

  /** Is this point on asphalt or sidewalk? */
  isOnPavement(x: number, y: number): boolean {
    return this.nearestRoad(x, y, SCRATCH).distance <= this.pavedWidth / 2
  }

  /**
   * Points along the sidewalks where passengers can stand: offset to one side
   * of a segment's centreline, clear of the asphalt, spaced along its length.
   * Intersection corners are excluded so no one stands in the crossing.
   */
  buildSidewalkSpots(spacing: number): Array<{ x: number; y: number }> {
    const spots: Array<{ x: number; y: number }> = []
    // Stand in the middle of the sidewalk band.
    const offset = (this.roadWidth / 2 + this.pavedWidth / 2) / 2
    const margin = this.pavedWidth // keep clear of intersections

    for (const s of this.segments) {
      const usable = s.length - margin * 2
      if (usable <= 0) continue
      const count = Math.max(1, Math.floor(usable / spacing))

      for (let i = 0; i < count; i++) {
        const t = margin + (usable * (i + 0.5)) / count
        for (const side of [-1, 1]) {
          if (s.horizontal) {
            spots.push({ x: s.ax + t, y: s.ay + side * offset })
          } else {
            spots.push({ x: s.ax + side * offset, y: s.ay + t })
          }
        }
      }
    }

    return spots
  }
}

/** Shared scratch for the boolean helpers, never exposed. */
const SCRATCH: RoadPoint = { x: 0, y: 0, tangent: 0, distance: 0, segmentIndex: -1 }
