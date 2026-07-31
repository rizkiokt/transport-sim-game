import { describe, it } from 'vitest'
import { generateCity3D } from './game/world/city3d.js'
import { InstancedMesh } from 'three'

describe('tmp', () => {
  it('counts', () => {
    for (const seed of ['town-1', 1, 'abc', 42]) {
      const city = generateCity3D(seed as never)
      let totalVerts = 0
      let totalTris = 0
      const rows: string[] = []
      city.root.traverse((o) => {
        const m = o as InstancedMesh
        const g = (m as never as { geometry?: { attributes?: Record<string, { count: number }>; index?: { count: number } } }).geometry
        if (!g || !g.attributes || !g.attributes['position']) return
        const vc = g.attributes['position']!.count
        const tris = (g.index ? g.index.count : vc) / 3
        const n = m.isInstancedMesh ? m.count : 1
        totalVerts += vc * n
        totalTris += tris * n
        rows.push(`${o.type} instances=${n} vertsEach=${vc} indexed=${!!g.index} totalVerts=${vc * n}`)
      })
      console.log('=== seed', seed, 'totalVerts', totalVerts, 'totalTris', totalTris)
      for (const r of rows) console.log('   ', r)
      city.dispose()
    }
  })
})
