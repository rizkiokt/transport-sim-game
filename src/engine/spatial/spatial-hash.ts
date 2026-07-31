/**
 * A uniform spatial hash grid.
 *
 * Answers "what is near this point?" without testing every entity. The game
 * asks this constantly — which passenger is the taxi close enough to pick up,
 * which buildings overlap the view, which traffic cars might collide — and a
 * naive O(n) scan per query becomes the frame budget as the town grows.
 *
 * A uniform grid (rather than a quadtree) is the right choice here because
 * entities are spread fairly evenly across the map and move every frame:
 * rebuilding a grid bucket is a couple of array pushes, whereas rebalancing a
 * tree is not.
 *
 * Cell size should be roughly the diameter of a typical query. Too small and
 * a query touches many cells; too large and each cell holds too many
 * entities.
 */

export interface SpatialItem {
  x: number
  y: number
}

export class SpatialHash<T extends SpatialItem> {
  readonly cellSize: number

  /** Bucket key -> items. Keys are packed cell coordinates. */
  readonly #cells = new Map<number, T[]>()

  /** Which key each item was inserted under, so `remove` is O(1)-ish. */
  readonly #itemCells = new Map<T, number>()

  #count = 0

  /** Scratch set reused by queries so they don't allocate per call. */
  readonly #seen = new Set<T>()

  constructor(cellSize = 128) {
    this.cellSize = cellSize
  }

  get size(): number {
    return this.#count
  }

  /** Number of occupied buckets — a rough load metric for the debug overlay. */
  get bucketCount(): number {
    return this.#cells.size
  }

  insert(item: T): void {
    const key = this.#keyFor(item.x, item.y)
    const existing = this.#itemCells.get(item)
    if (existing !== undefined) {
      if (existing === key) return
      this.#removeFromCell(existing, item)
      this.#count--
    }

    let bucket = this.#cells.get(key)
    if (!bucket) {
      bucket = []
      this.#cells.set(key, bucket)
    }
    bucket.push(item)
    this.#itemCells.set(item, key)
    this.#count++
  }

  remove(item: T): void {
    const key = this.#itemCells.get(item)
    if (key === undefined) return
    this.#removeFromCell(key, item)
    this.#itemCells.delete(item)
    this.#count--
  }

  /**
   * Re-bucket an item whose position changed. Cheap when it stayed in the
   * same cell, which is the common case for slow-moving entities.
   */
  update(item: T): void {
    const newKey = this.#keyFor(item.x, item.y)
    const oldKey = this.#itemCells.get(item)

    if (oldKey === newKey) return
    if (oldKey === undefined) {
      this.insert(item)
      return
    }

    this.#removeFromCell(oldKey, item)
    let bucket = this.#cells.get(newKey)
    if (!bucket) {
      bucket = []
      this.#cells.set(newKey, bucket)
    }
    bucket.push(item)
    this.#itemCells.set(item, newKey)
  }

  clear(): void {
    this.#cells.clear()
    this.#itemCells.clear()
    this.#count = 0
  }

  /**
   * Items within `radius` of a point, appended to `out`.
   *
   * Results are exact — the grid narrows candidates, then a real distance
   * test filters them.
   */
  queryRadius(x: number, y: number, radius: number, out: T[] = []): T[] {
    const radiusSq = radius * radius
    const minCellX = Math.floor((x - radius) / this.cellSize)
    const maxCellX = Math.floor((x + radius) / this.cellSize)
    const minCellY = Math.floor((y - radius) / this.cellSize)
    const maxCellY = Math.floor((y + radius) / this.cellSize)

    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const bucket = this.#cells.get(packKey(cx, cy))
        if (!bucket) continue
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i]!
          const dx = item.x - x
          const dy = item.y - y
          if (dx * dx + dy * dy <= radiusSq) out.push(item)
        }
      }
    }

    return out
  }

  /** Items whose position falls inside an axis-aligned rect. */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: T[] = []): T[] {
    const minCellX = Math.floor(minX / this.cellSize)
    const maxCellX = Math.floor(maxX / this.cellSize)
    const minCellY = Math.floor(minY / this.cellSize)
    const maxCellY = Math.floor(maxY / this.cellSize)

    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const bucket = this.#cells.get(packKey(cx, cy))
        if (!bucket) continue
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i]!
          if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
            out.push(item)
          }
        }
      }
    }

    return out
  }

  /**
   * The single closest item to a point within `maxRadius`, or null.
   *
   * Searches outward one ring of cells at a time and stops as soon as the
   * best hit is provably closer than the next ring could contain, so a nearby
   * passenger is found after inspecting a handful of cells.
   */
  findNearest(
    x: number,
    y: number,
    maxRadius: number,
    filter?: (item: T) => boolean,
  ): T | null {
    const centerX = Math.floor(x / this.cellSize)
    const centerY = Math.floor(y / this.cellSize)
    const maxRing = Math.ceil(maxRadius / this.cellSize)

    let best: T | null = null
    let bestDistSq = maxRadius * maxRadius

    for (let ring = 0; ring <= maxRing; ring++) {
      // Anything in a further ring is at least this far away, so if we already
      // have something closer we can stop.
      const ringMinDist = (ring - 1) * this.cellSize
      if (best !== null && ringMinDist > 0 && ringMinDist * ringMinDist > bestDistSq) break

      for (let cy = centerY - ring; cy <= centerY + ring; cy++) {
        for (let cx = centerX - ring; cx <= centerX + ring; cx++) {
          // Only the perimeter of this ring is new.
          const onPerimeter =
            ring === 0 ||
            cx === centerX - ring ||
            cx === centerX + ring ||
            cy === centerY - ring ||
            cy === centerY + ring
          if (!onPerimeter) continue

          const bucket = this.#cells.get(packKey(cx, cy))
          if (!bucket) continue

          for (let i = 0; i < bucket.length; i++) {
            const item = bucket[i]!
            if (filter && !filter(item)) continue
            const dx = item.x - x
            const dy = item.y - y
            const distSq = dx * dx + dy * dy
            if (distSq < bestDistSq) {
              bestDistSq = distSq
              best = item
            }
          }
        }
      }
    }

    return best
  }

  /**
   * Every unordered pair of items sharing or neighbouring a cell. Used for
   * broad-phase collision between traffic cars.
   */
  forEachNearbyPair(callback: (a: T, b: T) => void): void {
    for (const [key, bucket] of this.#cells) {
      const { cx, cy } = unpackKey(key)

      // Pairs within this cell.
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          callback(bucket[i]!, bucket[j]!)
        }
      }

      // Pairs against half the neighbours, so each pair is visited once.
      for (const [dx, dy] of FORWARD_NEIGHBOURS) {
        const other = this.#cells.get(packKey(cx + dx, cy + dy))
        if (!other) continue
        for (let i = 0; i < bucket.length; i++) {
          for (let j = 0; j < other.length; j++) {
            callback(bucket[i]!, other[j]!)
          }
        }
      }
    }
  }

  /** Rebuild from scratch. Simpler than incremental updates for static sets. */
  rebuild(items: Iterable<T>): void {
    this.clear()
    for (const item of items) this.insert(item)
  }

  #removeFromCell(key: number, item: T): void {
    const bucket = this.#cells.get(key)
    if (!bucket) return
    const index = bucket.indexOf(item)
    if (index >= 0) {
      // Swap-and-pop: order within a bucket is irrelevant.
      bucket[index] = bucket[bucket.length - 1]!
      bucket.pop()
    }
    if (bucket.length === 0) this.#cells.delete(key)
  }

  #keyFor(x: number, y: number): number {
    return packKey(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize))
  }

  /** Deduplicating scratch set, exposed for callers that query several regions. */
  get scratchSet(): Set<T> {
    this.#seen.clear()
    return this.#seen
  }
}

/**
 * Pack two signed cell coordinates into one number key.
 *
 * Offsetting by 32768 keeps coordinates positive, and 16 bits each fits
 * comfortably in a float64's integer range. That bounds the world to
 * +/-32768 cells (~4 million world units at a 128 unit cell) — far beyond
 * anything this game will use.
 */
function packKey(cx: number, cy: number): number {
  return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff)
}

function unpackKey(key: number): { cx: number; cy: number } {
  return {
    cx: (key >>> 16) - 32768,
    cy: (key & 0xffff) - 32768,
  }
}

/**
 * Half the 8-neighbourhood. Visiting only these directions from every cell
 * covers every adjacent pair exactly once.
 */
const FORWARD_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
]
