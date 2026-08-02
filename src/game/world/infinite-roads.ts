/**
 * The road grid for an endless city.
 *
 * The finite town stored an array of road segments and scanned it to answer
 * "where is the nearest road?". That cannot work for a world with no edges,
 * and it turns out not to be needed: on a regular grid, every road is a line
 * at `x = n * blockSize` or `z = n * blockSize`, so the nearest one is a
 * rounding operation. No arrays, no allocation, no scan — and it answers for
 * any coordinate, however far out.
 *
 * That makes this both the enabler for an infinite world and a straight
 * performance win over what it replaces.
 */

export interface RoadHit {
  /** Nearest point on a road centreline. */
  x: number
  z: number
  /** Direction of that road, radians. The opposite direction is equally valid. */
  tangent: number
  /** Distance from the query point to the centreline. */
  distance: number
  /** True when the nearest road runs along X (constant Z). */
  horizontal: boolean
}

export interface InfiniteRoadOptions {
  /** Distance between parallel roads, world units. */
  blockSize: number
  /** Asphalt width. */
  roadWidth: number
  /** Total paved width including footways. */
  pavedWidth: number
}

export class InfiniteRoads {
  readonly blockSize: number
  readonly roadWidth: number
  readonly pavedWidth: number

  constructor(options: InfiniteRoadOptions) {
    this.blockSize = options.blockSize
    this.roadWidth = options.roadWidth
    this.pavedWidth = options.pavedWidth
  }

  /**
   * Nearest road centreline point.
   *
   * Both axes are candidates; whichever gridline is closer wins. Writing into
   * `out` keeps this allocation-free, which matters because the car asks
   * every physics step.
   */
  nearestRoad(x: number, z: number, out?: RoadHit): RoadHit {
    const result: RoadHit =
      out ?? { x: 0, z: 0, tangent: 0, distance: 0, horizontal: true }

    const b = this.blockSize
    // Nearest gridline on each axis.
    const lineZ = Math.round(z / b) * b
    const lineX = Math.round(x / b) * b

    const distToHorizontal = Math.abs(z - lineZ)
    const distToVertical = Math.abs(x - lineX)

    if (distToHorizontal <= distToVertical) {
      // A road running along X at constant Z.
      result.x = x
      result.z = lineZ
      result.tangent = 0
      result.distance = distToHorizontal
      result.horizontal = true
    } else {
      result.x = lineX
      result.z = z
      result.tangent = Math.PI / 2
      result.distance = distToVertical
      result.horizontal = false
    }

    return result
  }

  /** Is this point on asphalt? */
  isOnRoad(x: number, z: number): boolean {
    return this.nearestRoad(x, z, SCRATCH).distance <= this.roadWidth / 2
  }

  /** Is this point on asphalt or footway? */
  isOnPavement(x: number, z: number): boolean {
    return this.nearestRoad(x, z, SCRATCH).distance <= this.pavedWidth / 2
  }

  /** Distance from a point to the nearest junction centre. */
  distanceToJunction(x: number, z: number): number {
    const b = this.blockSize
    return Math.hypot(x - Math.round(x / b) * b, z - Math.round(z / b) * b)
  }

  /** The junction nearest a point. */
  nearestJunction(x: number, z: number): { x: number; z: number } {
    const b = this.blockSize
    return { x: Math.round(x / b) * b, z: Math.round(z / b) * b }
  }

  /**
   * Where passengers can stand along the roads bounding one block.
   *
   * Generated per block rather than for the whole world, because in an
   * endless city there is no "whole world" to enumerate.
   *
   * @param blockX block index (the block spans blockX*b .. (blockX+1)*b)
   * @param spacing distance between spots along a road
   */
  buildSidewalkSpots(
    blockX: number,
    blockZ: number,
    spacing: number,
    out: Array<{ x: number; z: number }> = [],
  ): Array<{ x: number; z: number }> {
    const b = this.blockSize
    // Stand midway across the footway band.
    const offset = (this.roadWidth / 2 + this.pavedWidth / 2) / 2
    // Keep clear of junctions so nobody waits in a crossing.
    const margin = this.pavedWidth

    const usable = b - margin * 2
    if (usable <= 0) return out
    const count = Math.max(1, Math.floor(usable / spacing))

    const x0 = blockX * b
    const z0 = blockZ * b

    for (let i = 0; i < count; i++) {
      const t = margin + (usable * (i + 0.5)) / count

      // Two spots on the block's north edge, two on its west edge. Only two
      // of the four bounding roads are emitted per block, or every road would
      // get spots twice — once from the block on each side of it.
      out.push({ x: x0 + t, z: z0 - offset })
      out.push({ x: x0 + t, z: z0 + offset })
      out.push({ x: x0 - offset, z: z0 + t })
      out.push({ x: x0 + offset, z: z0 + t })
    }

    return out
  }
}

/** Shared scratch for the boolean helpers; never handed to callers. */
const SCRATCH: RoadHit = { x: 0, z: 0, tangent: 0, distance: 0, horizontal: true }
