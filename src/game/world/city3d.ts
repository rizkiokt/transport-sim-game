/**
 * The town in 3D.
 *
 * The layout logic is the same seeded grid as before — it produced a town
 * with no dead ends, which is exactly what a 6-year-old needs — but it is now
 * extruded into buildings with height, trees with canopies, and a road
 * surface that sits slightly above the grass.
 *
 * Performance strategy: buildings and trees are drawn with `InstancedMesh`,
 * so two hundred buildings cost **one** draw call instead of two hundred.
 * That is the difference between 60fps and 20fps on a cheap tablet. The
 * price is that every instance of a given mesh shares one geometry, so
 * variety comes from per-instance scale, rotation and colour rather than
 * from unique meshes.
 */

import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'

import { createRng, type Rng } from '../../engine/math/rng.js'
import { SpatialHash } from '../../engine/spatial/spatial-hash.js'
import {
  blobGeometry,
  coneCrownGeometry,
  pitchedRoofGeometry,
  taperedBlockGeometry,
  trunkGeometry,
} from '../../engine/three/geometry.js'
import { applyFacadeWindows } from './facade-material.js'
import { RoadNetwork } from './road-network.js'

/**
 * World scale. The 2D game used ~48 units per car length; 3D uses metres, so
 * everything from the layout logic is divided by this.
 */
export const WORLD_SCALE = 1 / 12

/** Layout constants, in the original 2D units, then scaled. */
const BLOCK_SIZE = 260
const ROAD_WIDTH = 64
const PAVED_WIDTH = 96
const COLS = 8
const ROWS = 6

/** Heights, in world units. */
const KERB_HEIGHT = 0.12
const ROAD_HEIGHT = 0.02

export interface Obstacle3D {
  /** Centre on the ground plane (x, z). SpatialHash uses x/y naming. */
  x: number
  y: number
  kind: 'building' | 'tree'
  /** Half-extents for buildings. */
  hw: number
  hh: number
  /** Radius for trees. */
  r: number
}

export interface City3D {
  /** Everything to add to the scene. */
  root: Group
  roads: RoadNetwork
  /** Collision index, in world units, keyed on the XZ plane. */
  obstacles: SpatialHash<Obstacle3D>
  /** Where passengers may stand, in world units. */
  sidewalkSpots: ReadonlyArray<{ x: number; z: number }>
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  dispose(): void
}

interface BuildingPlacement {
  x: number
  z: number
  width: number
  depth: number
  height: number
  color: Color
  rotation: number
  /**
   * Silhouette archetype. A town where every building is one extruded box
   * reads as a bar chart; varying the top is what makes a skyline.
   */
  form: 'flat' | 'setback' | 'pitched'
  /** Fraction of total height the lower volume occupies, for 'setback'. */
  setbackRatio: number
  /** Inset of the upper volume, as a fraction of footprint. */
  setbackInset: number
}

interface TreePlacement {
  x: number
  z: number
  scale: number
  rotation: number
  /** Broadleaf blob or conifer cone. */
  conifer: boolean
  color: Color
}

const BUILDING_COLORS = [0xc9705a, 0xe5d3ac, 0x7fb8a4, 0x8fa3bf, 0xe2907a, 0xd9b26f]
const ROOF_COLORS = [0xb0563f, 0xcbbfa4, 0x6d7f96, 0x8a6f52]
const FOLIAGE_COLORS = [0x3d7c3f, 0x529a54, 0x2f6b36, 0x67ad5c]

export function generateCity3D(seed: number | string): City3D {
  const roads = new RoadNetwork({
    cols: COLS,
    rows: ROWS,
    blockSize: BLOCK_SIZE,
    roadWidth: ROAD_WIDTH,
    pavedWidth: PAVED_WIDTH,
  })

  const rng = createRng(seed).fork('city3d')
  const root = new Group()
  const disposables: Array<BufferGeometry | Material> = []

  const buildings: BuildingPlacement[] = []
  const trees: TreePlacement[] = []

  // -- Layout (in 2D units, converted at placement time) -----------------
  const inset = PAVED_WIDTH / 2 + 14
  const interior = BLOCK_SIZE - inset * 2

  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const blockRng = rng.fork(`block:${col}:${row}`)
      const x0 = col * BLOCK_SIZE + inset
      const z0 = row * BLOCK_SIZE + inset

      if (blockRng.chance(0.24)) {
        // Park: open grass with scattered trees.
        const count = blockRng.int(5, 9)
        for (let i = 0; i < count; i++) {
          trees.push(
            makeTree(
              blockRng,
              (x0 + blockRng.range(20, interior - 20)) * WORLD_SCALE,
              (z0 + blockRng.range(20, interior - 20)) * WORLD_SCALE,
            ),
          )
        }
        continue
      }

      // Built block: a 2x2 lot grid.
      const lot = interior / 2
      for (let lz = 0; lz < 2; lz++) {
        for (let lx = 0; lx < 2; lx++) {
          const lotX = x0 + lx * lot
          const lotZ = z0 + lz * lot

          if (blockRng.chance(0.8)) {
            const w = blockRng.range(lot * 0.5, lot * 0.78)
            const d = blockRng.range(lot * 0.5, lot * 0.78)
            // Height in world units directly — 2 to 6 storeys.
            const storeys = blockRng.int(2, 7)
            // Short buildings get pitched roofs and read as houses; tall ones
            // step back like offices. Mixing the two is what stops a street
            // looking like a row of identical extrusions.
            const form =
              storeys <= 3
                ? blockRng.chance(0.7)
                  ? 'pitched'
                  : 'flat'
                : blockRng.chance(0.45)
                  ? 'setback'
                  : 'flat'

            buildings.push({
              x: (lotX + lot / 2) * WORLD_SCALE,
              z: (lotZ + lot / 2) * WORLD_SCALE,
              width: w * WORLD_SCALE,
              depth: d * WORLD_SCALE,
              height: storeys * 1.15,
              color: new Color(blockRng.pick(BUILDING_COLORS)),
              // Only right angles: a town of skewed buildings looks broken.
              rotation: blockRng.int(0, 3) * (Math.PI / 2),
              form,
              setbackRatio: blockRng.range(0.55, 0.72),
              setbackInset: blockRng.range(0.16, 0.3),
            })
          } else {
            const count = blockRng.int(1, 3)
            for (let i = 0; i < count; i++) {
              trees.push(
                makeTree(
                  blockRng,
                  (lotX + blockRng.range(16, lot - 16)) * WORLD_SCALE,
                  (lotZ + blockRng.range(16, lot - 16)) * WORLD_SCALE,
                ),
              )
            }
          }
        }
      }
    }
  }

  // -- Street trees --------------------------------------------------------
  // Block interiors are hidden behind buildings, so trees planted there are
  // invisible from the one place the player ever is: the road. A line of
  // trees along the verge is what actually makes a street feel like a street.
  //
  // The catch, found by a playtest that wedged the car solid: a car pulled up
  // at a passenger overhangs the pavement into the verge, so a tree there
  // traps it against the kerb with no way out. Trees are therefore refused
  // anywhere near a place a passenger can stand — a child must never be
  // punished for parking where the game told them to.
  const sidewalkSpots = roads
    .buildSidewalkSpots(110)
    .map((s) => ({ x: s.x * WORLD_SCALE, z: s.y * WORLD_SCALE }))

  /** Car half-width plus a tree's radius plus room to manoeuvre. */
  const PICKUP_CLEARANCE = 3.2

  const blocksAPickup = (x: number, z: number): boolean => {
    for (const spot of sidewalkSpots) {
      const dx = spot.x - x
      const dz = spot.z - z
      if (dx * dx + dz * dz < PICKUP_CLEARANCE * PICKUP_CLEARANCE) return true
    }
    return false
  }

  const verge = (PAVED_WIDTH / 2 + 8) * WORLD_SCALE
  const treeRng = rng.fork('street-trees')

  for (const s of roads.segments) {
    const ax = s.ax * WORLD_SCALE
    const az = s.ay * WORLD_SCALE
    const bx = s.bx * WORLD_SCALE
    const bz = s.by * WORLD_SCALE
    const length = Math.hypot(bx - ax, bz - az)

    // Leave junctions clear so corners stay open and readable.
    const clearance = PAVED_WIDTH * WORLD_SCALE
    const usable = length - clearance * 2
    if (usable <= 0) continue

    const spacing = 7
    const count = Math.floor(usable / spacing)

    for (let i = 0; i < count; i++) {
      // Skip some so the planting looks natural rather than regimented.
      if (treeRng.chance(0.32)) continue

      const t = (clearance + (usable * (i + 0.5)) / count) / length
      const cx = ax + (bx - ax) * t
      const cz = az + (bz - az) * t

      for (const side of [-1, 1]) {
        if (treeRng.chance(0.25)) continue
        const tx = s.horizontal ? cx : cx + side * verge
        const tz = s.horizontal ? cz + side * verge : cz
        if (blocksAPickup(tx, tz)) continue

        const tree = makeTree(treeRng, tx, tz)
        // Street trees are kept smaller so they never swamp the road view.
        tree.scale *= 0.8
        trees.push(tree)
      }
    }
  }

  // -- Ground ------------------------------------------------------------
  const margin = PAVED_WIDTH * WORLD_SCALE
  const minX = roads.minX * WORLD_SCALE - margin
  const minZ = roads.minY * WORLD_SCALE - margin
  const maxX = roads.maxX * WORLD_SCALE + margin
  const maxZ = roads.maxY * WORLD_SCALE + margin

  // Generously oversized so the horizon is grass, never void.
  const groundGeo = new PlaneGeometry((maxX - minX) * 3, (maxZ - minZ) * 3)
  const groundMat = new MeshStandardMaterial({ color: 0x63a24f, roughness: 0.95, metalness: 0 })
  disposables.push(groundGeo, groundMat)
  const ground = new Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  ground.receiveShadow = true
  root.add(ground)

  // -- Roads and kerbs ----------------------------------------------------
  // Asphalt is dark and fairly rough, but not matte — wet-look sheen at
  // grazing angles is a big part of why a road reads as a road.
  const roadMat = new MeshStandardMaterial({ color: 0x3f434e, roughness: 0.72, metalness: 0 })
  const kerbMat = new MeshStandardMaterial({ color: 0xcdc6b6, roughness: 0.9, metalness: 0 })
  const lineMat = new MeshStandardMaterial({
    color: 0xf4f4f0,
    roughness: 0.75,
    metalness: 0,
    side: DoubleSide,
  })
  disposables.push(roadMat, kerbMat, lineMat)

  // One box per segment, but boxes share geometry via scale — cheap enough
  // at ~60 segments, and far simpler than stitching a single road mesh.
  const unitBox = new BoxGeometry(1, 1, 1)
  disposables.push(unitBox)

  const kerbMesh = new InstancedMesh(unitBox, kerbMat, roads.segments.length)
  const roadMesh = new InstancedMesh(unitBox, roadMat, roads.segments.length)
  kerbMesh.receiveShadow = true
  roadMesh.receiveShadow = true

  const matrix = new Matrix4()
  const pos = new Vector3()
  const quat = new Quaternion()
  const scl = new Vector3()

  roads.segments.forEach((s, i) => {
    const ax = s.ax * WORLD_SCALE
    const az = s.ay * WORLD_SCALE
    const bx = s.bx * WORLD_SCALE
    const bz = s.by * WORLD_SCALE
    const cx = (ax + bx) / 2
    const cz = (az + bz) / 2
    // Overlap segment ends by the paved width so intersections fill in.
    const len = Math.hypot(bx - ax, bz - az) + PAVED_WIDTH * WORLD_SCALE

    const along = s.horizontal ? len : PAVED_WIDTH * WORLD_SCALE
    const across = s.horizontal ? PAVED_WIDTH * WORLD_SCALE : len

    pos.set(cx, KERB_HEIGHT / 2, cz)
    scl.set(along, KERB_HEIGHT, across)
    matrix.compose(pos, quat, scl)
    kerbMesh.setMatrixAt(i, matrix)

    const roadAlong = s.horizontal ? len : ROAD_WIDTH * WORLD_SCALE
    const roadAcross = s.horizontal ? ROAD_WIDTH * WORLD_SCALE : len
    pos.set(cx, KERB_HEIGHT + ROAD_HEIGHT / 2, cz)
    scl.set(roadAlong, ROAD_HEIGHT, roadAcross)
    matrix.compose(pos, quat, scl)
    roadMesh.setMatrixAt(i, matrix)
  })

  kerbMesh.instanceMatrix.needsUpdate = true
  roadMesh.instanceMatrix.needsUpdate = true
  root.add(kerbMesh, roadMesh)

  // Dashed centre lines: one thin plate per dash, instanced.
  const dashes = buildDashes(roads)
  if (dashes.length > 0) {
    const dashGeo = new PlaneGeometry(1, 1)
    disposables.push(dashGeo)
    const dashMesh = new InstancedMesh(dashGeo, lineMat, dashes.length)
    dashes.forEach((d, i) => {
      pos.set(d.x, KERB_HEIGHT + ROAD_HEIGHT + 0.008, d.z)
      quat.setFromAxisAngle(AXIS_X, -Math.PI / 2)
      scl.set(d.horizontal ? d.length : d.width, d.horizontal ? d.width : d.length, 1)
      matrix.compose(pos, quat, scl)
      dashMesh.setMatrixAt(i, matrix)
    })
    dashMesh.instanceMatrix.needsUpdate = true
    quat.identity()
    root.add(dashMesh)
  }

  // -- Buildings ----------------------------------------------------------
  // Drawn as three instanced passes rather than one, so the skyline has
  // silhouette variety without giving up instancing: a main volume everyone
  // shares, an upper volume only setback towers use, and a pitched roof only
  // houses use. Three draw calls, ~100 buildings, many different shapes.
  if (buildings.length > 0) {
    const bodyGeo = taperedBlockGeometry(1, 1, 1, 0.96, 0.05)
    const capGeo = taperedBlockGeometry(1, 1, 1, 0.9, 0.07)
    const roofGeo = pitchedRoofGeometry(1, 1, 1)
    disposables.push(bodyGeo, capGeo, roofGeo)

    const wallMat = new MeshStandardMaterial({ roughness: 0.82, metalness: 0.02 })
    applyFacadeWindows(wallMat)
    const trimMat = new MeshStandardMaterial({ roughness: 0.88, metalness: 0.02 })
    disposables.push(wallMat, trimMat)

    const setbacks = buildings.filter((b) => b.form === 'setback')
    const pitched = buildings.filter((b) => b.form === 'pitched')

    // Main volume: every building has one, but a setback tower's is shorter.
    const bodyMesh = new InstancedMesh(bodyGeo, wallMat, buildings.length)
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true

    // Upper volumes and cornices.
    const capCount = buildings.length + setbacks.length
    const capMesh = new InstancedMesh(capGeo, trimMat, capCount)
    capMesh.castShadow = true

    const roofMesh = new InstancedMesh(roofGeo, trimMat, Math.max(1, pitched.length))
    roofMesh.castShadow = true

    let capIndex = 0

    buildings.forEach((b, i) => {
      quat.setFromAxisAngle(AXIS_Y, b.rotation)

      // How tall the main volume is depends on the archetype.
      const bodyHeight =
        b.form === 'setback' ? b.height * b.setbackRatio : b.form === 'pitched' ? b.height * 0.86 : b.height

      pos.set(b.x, bodyHeight / 2, b.z)
      scl.set(b.width, bodyHeight, b.depth)
      matrix.compose(pos, quat, scl)
      bodyMesh.setMatrixAt(i, matrix)
      bodyMesh.setColorAt(i, b.color)

      if (b.form === 'setback') {
        // A narrower upper tower, plus its own cornice.
        const upperHeight = b.height - bodyHeight
        const inset = 1 - b.setbackInset
        pos.set(b.x, bodyHeight + upperHeight / 2, b.z)
        scl.set(b.width * inset, upperHeight, b.depth * inset)
        matrix.compose(pos, quat, scl)
        capMesh.setMatrixAt(capIndex, matrix)
        capMesh.setColorAt(capIndex, b.color)
        capIndex++

        // Ledge where the setback happens — the shadow line it casts is what
        // makes the step read as architecture rather than a modelling seam.
        pos.set(b.x, bodyHeight + 0.14, b.z)
        scl.set(b.width * 1.04, 0.28, b.depth * 1.04)
        matrix.compose(pos, quat, scl)
        capMesh.setMatrixAt(capIndex, matrix)
        capMesh.setColorAt(capIndex, ROOF_COLOR_CACHE[i % ROOF_COLOR_CACHE.length]!)
        capIndex++
      } else if (b.form === 'pitched') {
        const roofHeight = b.height * 0.28
        pos.set(b.x, bodyHeight, b.z)
        scl.set(b.width * 1.07, roofHeight, b.depth * 1.07)
        matrix.compose(pos, quat, scl)
        roofMesh.setMatrixAt(pitched.indexOf(b), matrix)
        roofMesh.setColorAt(pitched.indexOf(b), ROOF_COLOR_CACHE[i % ROOF_COLOR_CACHE.length]!)

        // Eaves.
        pos.set(b.x, bodyHeight - 0.06, b.z)
        scl.set(b.width * 1.09, 0.14, b.depth * 1.09)
        matrix.compose(pos, quat, scl)
        capMesh.setMatrixAt(capIndex, matrix)
        capMesh.setColorAt(capIndex, ROOF_COLOR_CACHE[i % ROOF_COLOR_CACHE.length]!)
        capIndex++
      } else {
        // A flat roof needs a parapet or it looks like a cut-off extrusion.
        pos.set(b.x, b.height + 0.16, b.z)
        scl.set(b.width * 1.03, 0.32, b.depth * 1.03)
        matrix.compose(pos, quat, scl)
        capMesh.setMatrixAt(capIndex, matrix)
        capMesh.setColorAt(capIndex, ROOF_COLOR_CACHE[i % ROOF_COLOR_CACHE.length]!)
        capIndex++
      }
    })

    // Unused instances would otherwise render as unit cubes at the origin.
    capMesh.count = capIndex
    roofMesh.count = pitched.length

    bodyMesh.instanceMatrix.needsUpdate = true
    capMesh.instanceMatrix.needsUpdate = true
    roofMesh.instanceMatrix.needsUpdate = true
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true
    if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true
    quat.identity()

    root.add(bodyMesh, capMesh)
    if (pitched.length > 0) root.add(roofMesh)
  }

  // -- Trees ---------------------------------------------------------------
  if (trees.length > 0) {
    const trunkGeo = trunkGeometry(0.13, 1)
    const blobGeo = blobGeometry(0.62, 1, 0.22, (i) => ((i * 47) % 17) / 17)
    const coneGeo = coneCrownGeometry(0.6, 1.6, 9)
    disposables.push(trunkGeo, blobGeo, coneGeo)

    const trunkMat = new MeshStandardMaterial({ color: 0x6f4a2c, roughness: 0.95, metalness: 0 })
    const foliageMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
    disposables.push(trunkMat, foliageMat)

    const trunkMesh = new InstancedMesh(trunkGeo, trunkMat, trees.length)
    trunkMesh.castShadow = true

    const broadleaf = trees.filter((t) => !t.conifer)
    const conifers = trees.filter((t) => t.conifer)

    const blobMesh = new InstancedMesh(blobGeo, foliageMat, Math.max(1, broadleaf.length))
    const coneMesh = new InstancedMesh(coneGeo, foliageMat, Math.max(1, conifers.length))
    blobMesh.castShadow = true
    coneMesh.castShadow = true

    trees.forEach((t, i) => {
      const trunkHeight = t.scale * (t.conifer ? 0.7 : 1.0)
      quat.setFromAxisAngle(AXIS_Y, t.rotation)
      pos.set(t.x, trunkHeight / 2, t.z)
      scl.set(t.scale, trunkHeight, t.scale)
      matrix.compose(pos, quat, scl)
      trunkMesh.setMatrixAt(i, matrix)
    })

    broadleaf.forEach((t, i) => {
      quat.setFromAxisAngle(AXIS_Y, t.rotation)
      pos.set(t.x, t.scale * 1.0 + t.scale * 0.42, t.z)
      scl.set(t.scale, t.scale * 0.95, t.scale)
      matrix.compose(pos, quat, scl)
      blobMesh.setMatrixAt(i, matrix)
      blobMesh.setColorAt(i, t.color)
    })

    conifers.forEach((t, i) => {
      quat.setFromAxisAngle(AXIS_Y, t.rotation)
      pos.set(t.x, t.scale * 0.7 + t.scale * 0.8, t.z)
      scl.set(t.scale, t.scale, t.scale)
      matrix.compose(pos, quat, scl)
      coneMesh.setMatrixAt(i, matrix)
      coneMesh.setColorAt(i, t.color)
    })

    trunkMesh.instanceMatrix.needsUpdate = true
    blobMesh.instanceMatrix.needsUpdate = true
    coneMesh.instanceMatrix.needsUpdate = true
    if (blobMesh.instanceColor) blobMesh.instanceColor.needsUpdate = true
    if (coneMesh.instanceColor) coneMesh.instanceColor.needsUpdate = true
    quat.identity()

    root.add(trunkMesh)
    if (broadleaf.length > 0) root.add(blobMesh)
    if (conifers.length > 0) root.add(coneMesh)
  }

  // -- Collision index ------------------------------------------------------
  const obstacles = new SpatialHash<Obstacle3D>(8)
  for (const b of buildings) {
    // A rotated building is still axis-aligned because rotations are
    // multiples of 90 degrees; swap extents on the odd quarter-turns.
    const swapped = Math.round(b.rotation / (Math.PI / 2)) % 2 === 1
    obstacles.insert({
      x: b.x,
      y: b.z,
      kind: 'building',
      hw: (swapped ? b.depth : b.width) / 2,
      hh: (swapped ? b.width : b.depth) / 2,
      r: 0,
    })
  }
  for (const t of trees) {
    obstacles.insert({ x: t.x, y: t.z, kind: 'tree', hw: 0, hh: 0, r: t.scale * 0.3 })
  }

  return {
    root,
    roads,
    obstacles,
    sidewalkSpots,
    bounds: { minX, minZ, maxX, maxZ },
    dispose(): void {
      for (const d of disposables) d.dispose()
      root.traverse((obj) => {
        if (obj instanceof InstancedMesh) obj.dispose()
      })
      root.clear()
    },
  }
}

function makeTree(rng: Rng, x: number, z: number): TreePlacement {
  return {
    x,
    z,
    scale: rng.range(0.85, 1.5),
    rotation: rng.range(0, Math.PI * 2),
    conifer: rng.chance(0.3),
    color: new Color(rng.pick(FOLIAGE_COLORS)),
  }
}

interface Dash {
  x: number
  z: number
  length: number
  width: number
  horizontal: boolean
}

/** Dashed centre lines along each road segment, in world units. */
function buildDashes(roads: RoadNetwork): Dash[] {
  const dashes: Dash[] = []
  const dashLength = 1.5
  const gap = 1.8
  const width = 0.22
  // Keep dashes clear of intersections so they don't cross each other.
  const margin = PAVED_WIDTH * WORLD_SCALE * 0.7

  for (const s of roads.segments) {
    const ax = s.ax * WORLD_SCALE
    const az = s.ay * WORLD_SCALE
    const bx = s.bx * WORLD_SCALE
    const bz = s.by * WORLD_SCALE
    const total = Math.hypot(bx - ax, bz - az)
    const usable = total - margin * 2
    if (usable <= dashLength) continue

    const stride = dashLength + gap
    const count = Math.floor(usable / stride)
    if (count <= 0) continue

    // Centre the run of dashes within the usable span.
    const runLength = count * stride - gap
    const start = margin + (usable - runLength) / 2

    for (let i = 0; i < count; i++) {
      const t = (start + i * stride + dashLength / 2) / total
      dashes.push({
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        length: dashLength,
        width,
        horizontal: s.horizontal,
      })
    }
  }

  return dashes
}

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const ROOF_COLOR_CACHE = ROOF_COLORS.map((c) => new Color(c))
