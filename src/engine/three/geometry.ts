/**
 * Procedural geometry helpers.
 *
 * The whole art direction rests on one idea: **nothing has a sharp edge**.
 * A cube reads as Minecraft; the same cube with a generous corner radius
 * reads as a toy. Every solid in this game is therefore built from rounded
 * primitives, and this module is where they come from.
 *
 * There are no model files. Geometry is generated once at startup and shared
 * between instances, so a town of two hundred buildings costs a handful of
 * buffers rather than two hundred downloads.
 */

import {
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Shape,
  SphereGeometry,
  Vector2,
} from 'three'

/**
 * A box with every edge rounded.
 *
 * Built by extruding a rounded rectangle with a bevel: the shape's corner
 * radius rounds the four vertical edges, and the bevel rounds the top and
 * bottom faces into the sides. Three.js has no built-in equivalent.
 *
 * @param radius corner radius. Clamped so it can never exceed half the
 *   smallest dimension, which would produce a self-intersecting mess.
 * @param smoothness segments per rounded corner. 2-3 is plenty at game scale.
 */
export function roundedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius = 0.15,
  smoothness = 3,
): BufferGeometry {
  const r = Math.min(radius, Math.min(width, height, depth) / 2 - 0.001)

  // The extruded shape is the cross-section in X/Y; depth becomes Z.
  const shapeWidth = width - r * 2
  const shapeHeight = height - r * 2

  const shape = new Shape()
  shape.moveTo(-shapeWidth / 2, -shapeHeight / 2 + r)
  shape.lineTo(-shapeWidth / 2, shapeHeight / 2 - r)
  shape.quadraticCurveTo(-shapeWidth / 2, shapeHeight / 2, -shapeWidth / 2 + r, shapeHeight / 2)
  shape.lineTo(shapeWidth / 2 - r, shapeHeight / 2)
  shape.quadraticCurveTo(shapeWidth / 2, shapeHeight / 2, shapeWidth / 2, shapeHeight / 2 - r)
  shape.lineTo(shapeWidth / 2, -shapeHeight / 2 + r)
  shape.quadraticCurveTo(shapeWidth / 2, -shapeHeight / 2, shapeWidth / 2 - r, -shapeHeight / 2)
  shape.lineTo(-shapeWidth / 2 + r, -shapeHeight / 2)
  shape.quadraticCurveTo(-shapeWidth / 2, -shapeHeight / 2, -shapeWidth / 2, -shapeHeight / 2 + r)

  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - r * 2,
    bevelEnabled: true,
    bevelSegments: smoothness,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: smoothness * 2,
  })

  // ExtrudeGeometry builds from z=0 forward; recentre on the origin.
  geometry.translate(0, 0, -(depth - r * 2) / 2)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A rounded box that is *also* tapered — narrower at the top than the bottom.
 * Gives buildings a subtle draft angle so a street of them doesn't read as a
 * row of shoeboxes.
 */
export function taperedBlockGeometry(
  width: number,
  height: number,
  depth: number,
  taper = 0.88,
  radius = 0.12,
): BufferGeometry {
  const geometry = roundedBoxGeometry(width, height, depth, radius)

  // Scale each vertex's X/Z toward the centre in proportion to its height.
  const pos = geometry.attributes['position']
  if (!pos) return geometry

  const array = pos.array as Float32Array
  const halfH = height / 2
  for (let i = 0; i < array.length; i += 3) {
    const y = array[i + 1]!
    // 0 at the base, 1 at the top.
    const t = (y + halfH) / height
    const scale = 1 + (taper - 1) * t
    array[i] = array[i]! * scale
    array[i + 2] = array[i + 2]! * scale
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A soft blob — a low-poly sphere with its vertices nudged outward
 * irregularly. Used for tree canopies and bushes, where perfect spheres look
 * artificial and noise makes them read as foliage.
 *
 * @param seedFn deterministic 0..1 source, so the same tree is the same shape
 *   every session.
 */
export function blobGeometry(
  radius: number,
  detail = 1,
  wobble = 0.18,
  seedFn: (index: number) => number = () => 0.5,
): BufferGeometry {
  const geometry = new IcosahedronGeometry(radius, detail)
  const pos = geometry.attributes['position']
  if (!pos) return geometry

  const array = pos.array as Float32Array
  for (let i = 0; i < array.length; i += 3) {
    const n = seedFn(i / 3)
    const scale = 1 + (n - 0.5) * 2 * wobble
    array[i] = array[i]! * scale
    array[i + 1] = array[i + 1]! * scale
    array[i + 2] = array[i + 2]! * scale
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/** A capsule — the friendly default for character bodies and limbs. */
export function capsuleGeometry(radius: number, length: number, segments = 8): BufferGeometry {
  return new CapsuleGeometry(radius, length, segments, segments * 2)
}

/** A sphere, slightly squashed. Heads read as friendlier when not perfectly round. */
export function headGeometry(radius: number, squash = 0.92, segments = 16): BufferGeometry {
  const geometry = new SphereGeometry(radius, segments, segments)
  geometry.scale(1, squash, 1)
  return geometry
}

/**
 * A wheel: a cylinder lying on its side, with a rounded tread profile so the
 * silhouette isn't a hard-edged disc.
 */
export function wheelGeometry(radius: number, width: number, segments = 16): BufferGeometry {
  const points: Vector2[] = []
  const treadRadius = width * 0.28

  // Lathe profile from the axle out to the tread and back.
  points.push(new Vector2(0, -width / 2))
  points.push(new Vector2(radius - treadRadius, -width / 2))
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * Math.PI - Math.PI / 2
    points.push(
      new Vector2(radius - treadRadius + Math.cos(a) * treadRadius, Math.sin(a) * (width / 2)),
    )
  }
  points.push(new Vector2(radius - treadRadius, width / 2))
  points.push(new Vector2(0, width / 2))

  const geometry = new LatheGeometry(points, segments)
  // Lathe spins around Y; a wheel spins around X.
  geometry.rotateZ(Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

/** A cone-ish tree crown with a rounded tip. */
export function coneCrownGeometry(radius: number, height: number, segments = 10): BufferGeometry {
  const geometry = new CylinderGeometry(radius * 0.08, radius, height, segments, 1, false)
  geometry.computeVertexNormals()
  return geometry
}

/** A simple tapered trunk. */
export function trunkGeometry(radius: number, height: number, segments = 8): BufferGeometry {
  const geometry = new CylinderGeometry(radius * 0.75, radius, height, segments)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A flat rounded-rectangle plate lying in the XZ plane, for road markings,
 * shadows and ground decals.
 */
export function plateGeometry(width: number, depth: number, radius = 0.1): BufferGeometry {
  const r = Math.min(radius, Math.min(width, depth) / 2 - 0.001)
  const w = width - r * 2
  const d = depth - r * 2

  const shape = new Shape()
  shape.moveTo(-w / 2, -d / 2 + r)
  shape.lineTo(-w / 2, d / 2 - r)
  shape.quadraticCurveTo(-w / 2, d / 2, -w / 2 + r, d / 2)
  shape.lineTo(w / 2 - r, d / 2)
  shape.quadraticCurveTo(w / 2, d / 2, w / 2, d / 2 - r)
  shape.lineTo(w / 2, -d / 2 + r)
  shape.quadraticCurveTo(w / 2, -d / 2, w / 2 - r, -d / 2)
  shape.lineTo(-w / 2 + r, -d / 2)
  shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2, -d / 2 + r)

  const geometry = new ExtrudeGeometry(shape, { depth: 0.001, bevelEnabled: false, curveSegments: 4 })
  // Extrusion is in XY; lay it flat.
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Dispose a geometry and everything it owns. Scenes call this on teardown;
 * WebGL buffers are not garbage collected with the JS object.
 */
export function disposeGeometries(...geometries: Array<BufferGeometry | null | undefined>): void {
  for (const g of geometries) g?.dispose()
}
