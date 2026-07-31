import { describe, expect, it } from 'vitest'

import { SpatialHash } from './spatial-hash.js'

interface Thing {
  x: number
  y: number
  id: number
}

function makeThing(id: number, x: number, y: number): Thing {
  return { id, x, y }
}

/** Brute-force reference implementation to check the grid against. */
function bruteForceRadius(items: Thing[], x: number, y: number, radius: number): Thing[] {
  return items.filter((i) => Math.hypot(i.x - x, i.y - y) <= radius)
}

describe('SpatialHash', () => {
  it('tracks size across insert and remove', () => {
    const grid = new SpatialHash<Thing>(50)
    const a = makeThing(1, 10, 10)
    const b = makeThing(2, 200, 200)

    grid.insert(a)
    grid.insert(b)
    expect(grid.size).toBe(2)

    grid.remove(a)
    expect(grid.size).toBe(1)

    // Removing something absent must be a no-op, not a negative count.
    grid.remove(a)
    expect(grid.size).toBe(1)
  })

  it('does not double-count a re-inserted item', () => {
    const grid = new SpatialHash<Thing>(50)
    const a = makeThing(1, 10, 10)
    grid.insert(a)
    grid.insert(a)
    expect(grid.size).toBe(1)

    a.x = 500
    grid.insert(a)
    expect(grid.size).toBe(1)
    expect(grid.queryRadius(500, 10, 5)).toHaveLength(1)
    expect(grid.queryRadius(10, 10, 5)).toHaveLength(0)
  })

  it('finds items within a radius and excludes those outside', () => {
    const grid = new SpatialHash<Thing>(64)
    const inside = makeThing(1, 105, 100)
    const outside = makeThing(2, 300, 100)
    grid.insert(inside)
    grid.insert(outside)

    const found = grid.queryRadius(100, 100, 20)
    expect(found).toHaveLength(1)
    expect(found[0]!.id).toBe(1)
  })

  it('matches brute force across a large random set', () => {
    const grid = new SpatialHash<Thing>(64)
    const items: Thing[] = []

    // Deterministic spread, including negative coordinates.
    let seed = 1
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    for (let i = 0; i < 800; i++) {
      const thing = makeThing(i, rand() * 2000 - 1000, rand() * 2000 - 1000)
      items.push(thing)
      grid.insert(thing)
    }

    for (let q = 0; q < 60; q++) {
      const qx = rand() * 2000 - 1000
      const qy = rand() * 2000 - 1000
      const radius = 20 + rand() * 180

      const expected = bruteForceRadius(items, qx, qy, radius)
        .map((i) => i.id)
        .sort((a, b) => a - b)
      const actual = grid
        .queryRadius(qx, qy, radius)
        .map((i) => i.id)
        .sort((a, b) => a - b)

      expect(actual).toEqual(expected)
    }
  })

  it('handles negative coordinates', () => {
    const grid = new SpatialHash<Thing>(32)
    const a = makeThing(1, -500, -500)
    const b = makeThing(2, -495, -505)
    grid.insert(a)
    grid.insert(b)

    const found = grid.queryRadius(-500, -500, 20)
    expect(found.map((i) => i.id).sort()).toEqual([1, 2])
  })

  it('re-buckets an item after it moves', () => {
    const grid = new SpatialHash<Thing>(50)
    const a = makeThing(1, 10, 10)
    grid.insert(a)

    a.x = 500
    a.y = 500
    grid.update(a)

    expect(grid.queryRadius(10, 10, 20)).toHaveLength(0)
    expect(grid.queryRadius(500, 500, 20)).toHaveLength(1)
    expect(grid.size).toBe(1)
  })

  it('update() inserts an item it has never seen', () => {
    const grid = new SpatialHash<Thing>(50)
    const a = makeThing(1, 10, 10)
    grid.update(a)
    expect(grid.size).toBe(1)
    expect(grid.queryRadius(10, 10, 5)).toHaveLength(1)
  })

  it('finds the genuinely nearest item, not merely a near one', () => {
    const grid = new SpatialHash<Thing>(40)
    const near = makeThing(1, 12, 0)
    const far = makeThing(2, 100, 0)
    // Deliberately insert the far one first so ordering cannot mask a bug.
    grid.insert(far)
    grid.insert(near)

    expect(grid.findNearest(0, 0, 500)?.id).toBe(1)
  })

  it('findNearest respects maxRadius and the filter', () => {
    const grid = new SpatialHash<Thing>(40)
    const a = makeThing(1, 30, 0)
    const b = makeThing(2, 60, 0)
    grid.insert(a)
    grid.insert(b)

    expect(grid.findNearest(0, 0, 10)).toBeNull()
    // Filtering out the closer one must fall through to the next.
    expect(grid.findNearest(0, 0, 200, (i) => i.id !== 1)?.id).toBe(2)
  })

  it('findNearest agrees with brute force over random queries', () => {
    const grid = new SpatialHash<Thing>(48)
    const items: Thing[] = []

    let seed = 99
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    for (let i = 0; i < 400; i++) {
      const thing = makeThing(i, rand() * 1200 - 600, rand() * 1200 - 600)
      items.push(thing)
      grid.insert(thing)
    }

    for (let q = 0; q < 80; q++) {
      const qx = rand() * 1200 - 600
      const qy = rand() * 1200 - 600
      const maxRadius = 400

      let expected: Thing | null = null
      let bestDist = maxRadius
      for (const item of items) {
        const d = Math.hypot(item.x - qx, item.y - qy)
        if (d < bestDist) {
          bestDist = d
          expected = item
        }
      }

      const actual = grid.findNearest(qx, qy, maxRadius)
      if (expected === null) {
        expect(actual).toBeNull()
      } else {
        // Compare by distance: ties on distance are equally correct answers.
        expect(actual).not.toBeNull()
        const actualDist = Math.hypot(actual!.x - qx, actual!.y - qy)
        expect(actualDist).toBeCloseTo(bestDist, 6)
      }
    }
  })

  it('queries a rect by containment', () => {
    const grid = new SpatialHash<Thing>(32)
    grid.insert(makeThing(1, 10, 10))
    grid.insert(makeThing(2, 50, 50))
    grid.insert(makeThing(3, 500, 500))

    const found = grid
      .queryRect(0, 0, 100, 100)
      .map((i) => i.id)
      .sort((a, b) => a - b)
    expect(found).toEqual([1, 2])
  })

  it('visits each nearby pair exactly once', () => {
    const grid = new SpatialHash<Thing>(50)
    const things = [
      makeThing(1, 10, 10),
      makeThing(2, 20, 20),
      makeThing(3, 60, 10), // neighbouring cell
    ]
    for (const t of things) grid.insert(t)

    const pairs: string[] = []
    grid.forEachNearbyPair((a, b) => {
      pairs.push([a.id, b.id].sort((x, y) => x - y).join('-'))
    })

    expect(new Set(pairs).size).toBe(pairs.length)
    expect(pairs).toContain('1-2')
    expect(pairs).toContain('1-3')
  })

  it('clears everything', () => {
    const grid = new SpatialHash<Thing>(50)
    grid.insert(makeThing(1, 10, 10))
    grid.insert(makeThing(2, 20, 20))
    grid.clear()

    expect(grid.size).toBe(0)
    expect(grid.bucketCount).toBe(0)
    expect(grid.queryRadius(10, 10, 100)).toHaveLength(0)
  })

  it('drops empty buckets so the map does not leak as entities move', () => {
    const grid = new SpatialHash<Thing>(50)
    const a = makeThing(1, 10, 10)
    grid.insert(a)
    expect(grid.bucketCount).toBe(1)

    for (let i = 0; i < 50; i++) {
      a.x = i * 100
      grid.update(a)
    }
    // One item can only ever occupy one bucket.
    expect(grid.bucketCount).toBe(1)
  })
})
