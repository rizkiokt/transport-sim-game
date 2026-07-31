import { describe, it } from 'vitest'
import { InstancedMesh, Mesh, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { generateCity3D } from './game/world/city3d.js'

describe('verify', () => {
  it('measures', () => {
    const city = generateCity3D('sunnyville-1')
    let totalVerts = 0
    let totalTris = 0
    let calls = 0
    const rows: string[] = []
    city.root.traverse((obj) => {
      if (obj instanceof InstancedMesh) {
        const g = obj.geometry
        g.computeBoundingSphere()
        const posAttr = g.attributes['position']!
        const vcount = posAttr.count
        const icount = g.index ? g.index.count : posAttr.count
        obj.computeBoundingSphere()
        const bs = obj.boundingSphere
        rows.push(
          `INSTANCED ${obj.name || g.type} instances=${obj.count} vertsPerInstance=${vcount} tris=${icount / 3} totalVerts=${vcount * obj.count} castShadow=${obj.castShadow} recvShadow=${obj.receiveShadow} frustumCulled=${obj.frustumCulled} bsRadius=${bs?.radius.toFixed(2)} bsCenter=${bs ? `${bs.center.x.toFixed(1)},${bs.center.y.toFixed(1)},${bs.center.z.toFixed(1)}` : 'n/a'}`,
        )
        totalVerts += vcount * obj.count
        totalTris += (icount / 3) * obj.count
        calls++
      } else if (obj instanceof Mesh) {
        const g = obj.geometry
        const posAttr = g.attributes['position']!
        rows.push(`MESH ${g.type} verts=${posAttr.count} castShadow=${obj.castShadow}`)
        totalVerts += posAttr.count
        calls++
      }
    })
    rows.push(`TOTAL verts=${totalVerts} tris=${Math.round(totalTris)} drawcalls=${calls}`)
    rows.push(
      `BOUNDS ${JSON.stringify(city.bounds)} width=${(city.bounds.maxX - city.bounds.minX).toFixed(1)} depth=${(city.bounds.maxZ - city.bounds.minZ).toFixed(1)}`,
    )

    // Frustum test: camera at town centre looking at a wall
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 220)
    cam.position.set(
      (city.bounds.minX + city.bounds.maxX) / 2,
      3,
      (city.bounds.minZ + city.bounds.maxZ) / 2,
    )
    cam.lookAt(new Vector3(cam.position.x + 1, 2, cam.position.z))
    cam.updateMatrixWorld(true)
    const frustum = new Frustum()
    frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
    city.root.updateMatrixWorld(true)
    city.root.traverse((obj) => {
      if (obj instanceof InstancedMesh) {
        rows.push(`CULLTEST ${obj.geometry.type} visible=${frustum.intersectsObject(obj)}`)
      }
    })
    // eslint-disable-next-line
    ;(globalThis as any).process.stdout.write('\n===\n' + rows.join('\n') + '\n===\n')
  })
})
