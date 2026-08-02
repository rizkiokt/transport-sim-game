/**
 * Endless city, streamed in chunks.
 *
 * The world is generated on demand around the player and forgotten behind
 * them. Every chunk is derived purely from its coordinates and the world
 * seed, so the same place always regenerates identically — drive away for ten
 * minutes, come back, and the same buildings are there. Nothing about the
 * world is stored in the save.
 *
 * **The central design decision is that draw calls do not grow with the
 * world.** The obvious approach — one InstancedMesh per chunk — puts a
 * hundred-odd draw calls on screen and gets worse the further you can see.
 * Instead there is a fixed set of large InstancedMeshes covering the whole
 * visible area, and loading or unloading a chunk rewrites their instance
 * buffers. The buffer rebuild is O(visible instances) but only runs when the
 * player crosses a chunk boundary, which is every few seconds of driving.
 *
 * Geometry is deliberately cheaper than the finite town's was. An endless
 * city has several times more buildings on screen, so each one has to cost
 * proportionally less: fewer bevel segments, fewer curve segments.
 */

import {
  BoxGeometry,
  Color,
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
import type { QualityTier } from '../../engine/three/renderer.js'
import { WORLD_SCALE, type DriveWorld, type Obstacle3D } from './drive-world.js'
import {
  blobGeometry,
  coneCrownGeometry,
  pitchedRoofGeometry,
  taperedBlockGeometry,
  trunkGeometry,
} from '../../engine/three/geometry.js'
import { applyWorldUV, type SurfaceLibrary } from '../../engine/three/textures.js'
import { applyFacadeWindows } from './facade-material.js'
import { InfiniteRoads } from './infinite-roads.js'

const BLOCK_SIZE = 260 * WORLD_SCALE
const ROAD_WIDTH = 64 * WORLD_SCALE
const PAVED_WIDTH = 96 * WORLD_SCALE

/** Blocks per chunk edge. */
const BLOCKS_PER_CHUNK = 4
const CHUNK_SIZE = BLOCK_SIZE * BLOCKS_PER_CHUNK

const KERB_HEIGHT = 0.12
const ROAD_HEIGHT = 0.02

const BUILDING_COLORS = [0xc9705a, 0xe5d3ac, 0x7fb8a4, 0x8fa3bf, 0xe2907a, 0xd9b26f]
const ROOF_COLORS = [0xb0563f, 0xcbbfa4, 0x6d7f96, 0x8a6f52]
const FOLIAGE_COLORS = [0x3d7c3f, 0x529a54, 0x2f6b36, 0x67ad5c]

interface BuildingPlacement {
  x: number
  z: number
  width: number
  depth: number
  height: number
  colorIndex: number
  roofIndex: number
  rotation: number
  form: 'flat' | 'setback' | 'pitched'
  setbackRatio: number
  setbackInset: number
}

interface TreePlacement {
  x: number
  z: number
  scale: number
  rotation: number
  conifer: boolean
  colorIndex: number
}

interface Chunk {
  cx: number
  cz: number
  buildings: BuildingPlacement[]
  trees: TreePlacement[]
  sidewalkSpots: Array<{ x: number; z: number }>
  obstacles: Obstacle3D[]
}

/**
 * Streaming radius, in chunks, for each quality tier.
 *
 * This is paired with `RENDER_PROFILES[tier].drawDistance`: `radius *
 * CHUNK_SIZE` is how far the world is guaranteed to have been built in every
 * direction, so a far plane beyond it would show the world simply stopping in
 * clear air. The two numbers have to move together, and a unit test asserts
 * they still do — which is the only reason it is safe to tune either.
 */
export const WORLD_RADIUS_FOR_TIER: Record<QualityTier, number> = {
  low: 2,
  medium: 2,
  high: 3,
}

export interface WorldStreamerOptions {
  seed: number | string
  surfaces?: SurfaceLibrary
  /** How far, in chunks, to keep the world loaded around the player. */
  radius?: number
  /**
   * The largest radius this streamer will ever be set to.
   *
   * Instance pools are sized from this, because the adaptive quality watchdog
   * can raise the radius back up at runtime and a pool sized for the starting
   * tier would silently truncate the world after an upgrade.
   */
  maxRadius?: number
  /** Ceiling on visible buildings; instance buffers are sized to this. */
  maxBuildings?: number
  maxTrees?: number
  /**
   * Block keys (`"bx:bz"`) to leave empty.
   *
   * Hand-placed landmarks — the depot — own whole blocks, and generated
   * buildings would otherwise grow straight through them.
   */
  reservedBlocks?: ReadonlySet<string>
}

export class WorldStreamer implements DriveWorld {
  readonly root = new Group()
  readonly roads: InfiniteRoads
  readonly obstacles = new SpatialHash<Obstacle3D>(8)

  /** Sidewalk spots across every loaded chunk. */
  get sidewalkSpots(): ReadonlyArray<{ x: number; z: number }> {
    return this.#spots
  }

  readonly #seed: number | string
  #radius: number
  readonly #maxRadius: number
  readonly #reserved: ReadonlySet<string>
  /**
   * Obstacles that are not part of any chunk — hand-placed landmarks.
   * Re-inserted on every rebuild, since a rebuild clears the whole index.
   */
  readonly #staticObstacles: Obstacle3D[] = []
  readonly #chunks = new Map<string, Chunk>()
  #spots: Array<{ x: number; z: number }> = []

  /** Chunk the player was in at the last rebuild. */
  #lastChunkX = Number.NaN
  #lastChunkZ = Number.NaN

  // Fixed instance pools. Their count changes; their number never does.
  readonly #buildingMesh: InstancedMesh
  readonly #capMesh: InstancedMesh
  readonly #roofMesh: InstancedMesh
  readonly #trunkMesh: InstancedMesh
  readonly #blobMesh: InstancedMesh
  readonly #coneMesh: InstancedMesh
  readonly #roadMesh: InstancedMesh
  readonly #kerbMesh: InstancedMesh
  readonly #ground: Mesh

  readonly #disposables: Array<BufferGeometry | Material> = []
  readonly #matrix = new Matrix4()
  readonly #pos = new Vector3()
  readonly #quat = new Quaternion()
  readonly #scale = new Vector3()

  readonly #buildingColors = BUILDING_COLORS.map((c) => new Color(c))
  readonly #roofColors = ROOF_COLORS.map((c) => new Color(c))
  readonly #foliageColors = FOLIAGE_COLORS.map((c) => new Color(c))

  constructor(options: WorldStreamerOptions) {
    this.#seed = options.seed
    this.#radius = options.radius ?? 2
    this.#maxRadius = Math.max(this.#radius, options.maxRadius ?? this.#radius)
    this.#reserved = options.reservedBlocks ?? new Set()

    this.roads = new InfiniteRoads({
      blockSize: BLOCK_SIZE,
      roadWidth: ROAD_WIDTH,
      pavedWidth: PAVED_WIDTH,
    })

    // Sized from the MAXIMUM radius, not the current one.
    const span = this.#maxRadius * 2 + 1
    const blocks = span * span * BLOCKS_PER_CHUNK * BLOCKS_PER_CHUNK

    // Pool sizes are DERIVED from the loaded area, not guessed.
    //
    // Fixed guesses were silently wrong: at radius 3 the world wants ~2000
    // buildings and the pool held 1400, so several hundred buildings simply
    // did not exist — with no error, just gaps in the city that changed as
    // you drove. Sizing from the worst case a block can produce (four lots,
    // plus a setback upper for each) means the world is never truncated.
    const maxBuildings = options.maxBuildings ?? blocks * 8
    // Parks are the worst case: up to 9 trees, plus lot and verge planting.
    const maxTrees = options.maxTrees ?? blocks * 12
    // Two road boxes per block edge, in both axes, across every loaded chunk.
    const maxRoadPieces = span * span * BLOCKS_PER_CHUNK * BLOCKS_PER_CHUNK * 2 + 64

    // -- Ground ------------------------------------------------------------
    // One very large plane that simply follows the player. An endless world
    // does not need endless ground geometry, only ground that is always
    // under you and always reaches the fog.
    const groundGeo = new PlaneGeometry(1600, 1600)
    const groundMat = new MeshStandardMaterial({ color: 0x9fbf8f, roughness: 0.95, metalness: 0 })
    if (options.surfaces) {
      groundMat.map = options.surfaces.grass.map
      groundMat.normalMap = options.surfaces.grass.normalMap
      groundMat.roughnessMap = options.surfaces.grass.roughnessMap
      // World-space UVs are essential here: the plane moves with the player,
      // and mesh UVs would drag the grass texture along with it.
      applyWorldUV(groundMat, 0.12)
    }
    this.#disposables.push(groundGeo, groundMat)
    this.#ground = new Mesh(groundGeo, groundMat)
    this.#ground.rotation.x = -Math.PI / 2
    this.#ground.receiveShadow = true
    this.root.add(this.#ground)

    // -- Materials ----------------------------------------------------------
    const roadMat = new MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.72, metalness: 0 })
    const kerbMat = new MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9, metalness: 0 })
    if (options.surfaces) {
      roadMat.map = options.surfaces.asphalt.map
      roadMat.normalMap = options.surfaces.asphalt.normalMap
      roadMat.roughnessMap = options.surfaces.asphalt.roughnessMap
      applyWorldUV(roadMat, 0.35)
      kerbMat.map = options.surfaces.concrete.map
      kerbMat.normalMap = options.surfaces.concrete.normalMap
      kerbMat.roughnessMap = options.surfaces.concrete.roughnessMap
      applyWorldUV(kerbMat, 0.3)
    }

    const wallMat = new MeshStandardMaterial({ roughness: 0.82, metalness: 0.02 })
    if (options.surfaces) wallMat.roughnessMap = options.surfaces.wall.roughnessMap
    applyFacadeWindows(wallMat)
    const trimMat = new MeshStandardMaterial({ roughness: 0.88, metalness: 0.02 })
    const trunkMat = new MeshStandardMaterial({ color: 0x6f4a2c, roughness: 0.95, metalness: 0 })
    const foliageMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 })
    this.#disposables.push(roadMat, kerbMat, wallMat, trimMat, trunkMat, foliageMat)

    // -- Geometry ------------------------------------------------------------
    // Cheaper than the finite town's: several times more buildings are on
    // screen at once, so each must cost proportionally less.
    const bodyGeo = taperedBlockGeometry(1, 1, 1, 0.96, 0.05, 1)
    // Parapets and roof trim are flat slabs seen edge-on from the street. A
    // rounded, tapered box spent 92 triangles each on corners nobody can
    // resolve; a plain box costs 12 and is indistinguishable in play. At
    // ~2000 of them on screen that one substitution was the single largest
    // triangle saving in the scene.
    const capGeo = new BoxGeometry(1, 1, 1)
    const roofGeo = pitchedRoofGeometry(1, 1, 1)
    const trunkGeo = trunkGeometry(0.13, 1, 6)
    const blobGeo = blobGeometry(0.62, 0, 0.22, (i) => ((i * 47) % 17) / 17)
    const coneGeo = coneCrownGeometry(0.6, 1.6, 7)
    const quadGeo = new PlaneGeometry(1, 1)
    this.#disposables.push(bodyGeo, capGeo, roofGeo, trunkGeo, blobGeo, coneGeo, quadGeo)

    const make = (geo: BufferGeometry, mat: Material, n: number, shadow: boolean): InstancedMesh => {
      const mesh = new InstancedMesh(geo, mat, n)
      mesh.castShadow = shadow
      mesh.receiveShadow = shadow
      mesh.count = 0
      // The world moves under a stationary origin; per-instance culling would
      // be wrong anyway since the bounding volume spans the loaded area.
      mesh.frustumCulled = false
      this.root.add(mesh)
      return mesh
    }

    this.#buildingMesh = make(bodyGeo, wallMat, maxBuildings, true)
    this.#capMesh = make(capGeo, trimMat, maxBuildings, true)
    this.#roofMesh = make(roofGeo, trimMat, maxBuildings, true)
    this.#trunkMesh = make(trunkGeo, trunkMat, maxTrees, true)
    this.#blobMesh = make(blobGeo, foliageMat, maxTrees, true)
    this.#coneMesh = make(coneGeo, foliageMat, maxTrees, true)

    // Roads are flat planes rather than boxes: a box's sides are never seen,
    // and at this count that is four wasted faces per piece.
    this.#roadMesh = make(quadGeo, roadMat, maxRoadPieces, false)
    this.#kerbMesh = make(quadGeo, kerbMat, maxRoadPieces, false)
    this.#roadMesh.receiveShadow = true
    this.#kerbMesh.receiveShadow = true
  }

  /**
   * Load and unload chunks around a position.
   *
   * Cheap to call every frame: it early-outs unless the player has actually
   * crossed into a different chunk.
   */
  update(x: number, z: number): void {
    // Keep the ground under the player, snapped so the world-space grass UVs
    // do not shimmer as it moves.
    this.#ground.position.set(Math.round(x / 8) * 8, 0, Math.round(z / 8) * 8)

    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    if (cx === this.#lastChunkX && cz === this.#lastChunkZ) return
    this.#lastChunkX = cx
    this.#lastChunkZ = cz

    const wanted = new Set<string>()
    for (let dz = -this.#radius; dz <= this.#radius; dz++) {
      for (let dx = -this.#radius; dx <= this.#radius; dx++) {
        const key = `${cx + dx}:${cz + dz}`
        wanted.add(key)
        if (!this.#chunks.has(key)) {
          this.#chunks.set(key, this.#generateChunk(cx + dx, cz + dz))
        }
      }
    }

    for (const key of [...this.#chunks.keys()]) {
      if (!wanted.has(key)) this.#chunks.delete(key)
    }

    this.#rebuildInstances()
  }

  /**
   * Register obstacles that outlive chunk streaming.
   *
   * A rebuild clears the spatial index wholesale, so anything not owned by a
   * chunk has to be re-added each time; keeping the list here is what makes
   * the depot walls solid no matter where the player drives.
   */
  addStaticObstacles(obstacles: readonly Obstacle3D[]): void {
    this.#staticObstacles.push(...obstacles)
    for (const ob of obstacles) this.obstacles.insert(ob)
  }

  /**
   * Change how much world is kept loaded.
   *
   * The adaptive quality watchdog moves the draw distance at runtime, and the
   * streaming radius has to follow it. Without this, a tablet that starts on
   * the high tier and is downgraded three seconds later keeps generating and
   * drawing a high-tier world for the rest of the session — several hundred
   * thousand triangles of city sitting entirely behind the fog, on precisely
   * the device that could least afford it.
   *
   * Clamped to the pool capacity this streamer was built with.
   */
  setRadius(radius: number): void {
    const next = Math.max(1, Math.min(this.#maxRadius, Math.round(radius)))
    if (next === this.#radius) return
    this.#radius = next

    // Force the next update to reconsider which chunks it wants.
    this.#lastChunkX = Number.NaN
    this.#lastChunkZ = Number.NaN
  }

  get radius(): number {
    return this.#radius
  }

  /** Force a full rebuild, e.g. after teleporting. */
  refresh(x: number, z: number): void {
    this.#lastChunkX = Number.NaN
    this.#lastChunkZ = Number.NaN
    this.update(x, z)
  }

  // ------------------------------------------------------------- generation

  #generateChunk(cx: number, cz: number): Chunk {
    // Seeded on chunk coordinates, so a place always regenerates identically
    // no matter what route the player took to reach it.
    const rng = createRng(`${this.#seed}:chunk:${cx}:${cz}`)

    const buildings: BuildingPlacement[] = []
    const trees: TreePlacement[] = []
    const spots: Array<{ x: number; z: number }> = []
    const obstacles: Obstacle3D[] = []

    const inset = PAVED_WIDTH / 2 + 14 * WORLD_SCALE
    const interior = BLOCK_SIZE - inset * 2

    for (let bz = 0; bz < BLOCKS_PER_CHUNK; bz++) {
      for (let bx = 0; bx < BLOCKS_PER_CHUNK; bx++) {
        const blockX = cx * BLOCKS_PER_CHUNK + bx
        const blockZ = cz * BLOCKS_PER_CHUNK + bz
        const blockRng = rng.fork(`block:${bx}:${bz}`)

        // Pavement still runs past a reserved block — people wait outside the
        // depot like anywhere else — but nothing is built on it.
        this.roads.buildSidewalkSpots(blockX, blockZ, 110 * WORLD_SCALE, spots)
        if (this.#reserved.has(`${blockX}:${blockZ}`)) continue

        const x0 = blockX * BLOCK_SIZE + inset
        const z0 = blockZ * BLOCK_SIZE + inset

        if (blockRng.chance(0.24)) {
          // A park: open grass with scattered trees.
          const count = blockRng.int(5, 9)
          for (let i = 0; i < count; i++) {
            trees.push(
              this.#makeTree(
                blockRng,
                x0 + blockRng.range(2, interior - 2),
                z0 + blockRng.range(2, interior - 2),
              ),
            )
          }
          continue
        }

        const lot = interior / 2
        for (let lz = 0; lz < 2; lz++) {
          for (let lx = 0; lx < 2; lx++) {
            const lotX = x0 + lx * lot
            const lotZ = z0 + lz * lot

            if (blockRng.chance(0.8)) {
              const w = blockRng.range(lot * 0.5, lot * 0.78)
              const d = blockRng.range(lot * 0.5, lot * 0.78)
              const storeys = blockRng.int(2, 7)
              const form =
                storeys <= 3
                  ? blockRng.chance(0.7)
                    ? 'pitched'
                    : 'flat'
                  : blockRng.chance(0.45)
                    ? 'setback'
                    : 'flat'

              buildings.push({
                x: lotX + lot / 2,
                z: lotZ + lot / 2,
                width: w,
                depth: d,
                height: storeys * 1.15,
                colorIndex: blockRng.int(0, BUILDING_COLORS.length - 1),
                roofIndex: blockRng.int(0, ROOF_COLORS.length - 1),
                rotation: blockRng.int(0, 3) * (Math.PI / 2),
                form,
                setbackRatio: blockRng.range(0.55, 0.72),
                setbackInset: blockRng.range(0.16, 0.3),
              })
            } else {
              const count = blockRng.int(1, 3)
              for (let i = 0; i < count; i++) {
                trees.push(
                  this.#makeTree(
                    blockRng,
                    lotX + blockRng.range(1.4, lot - 1.4),
                    lotZ + blockRng.range(1.4, lot - 1.4),
                  ),
                )
              }
            }
          }
        }
      }
    }

    // Street trees, refused anywhere a car pulling up to a passenger would
    // sit — the same trap that once wedged the car solid in the finite town.
    const verge = PAVED_WIDTH / 2 + 8 * WORLD_SCALE
    const treeRng = rng.fork('street-trees')
    const clearanceSq = 3.2 * 3.2
    const blocksAPickup = (px: number, pz: number): boolean =>
      spots.some((s) => (s.x - px) ** 2 + (s.z - pz) ** 2 < clearanceSq)

    for (let bz = 0; bz < BLOCKS_PER_CHUNK; bz++) {
      for (let bx = 0; bx < BLOCKS_PER_CHUNK; bx++) {
        const lineX = (cx * BLOCKS_PER_CHUNK + bx) * BLOCK_SIZE
        const lineZ = (cz * BLOCKS_PER_CHUNK + bz) * BLOCK_SIZE
        const clearance = PAVED_WIDTH
        const usable = BLOCK_SIZE - clearance * 2
        if (usable <= 0) continue
        const count = Math.floor(usable / 7)

        for (let i = 0; i < count; i++) {
          if (treeRng.chance(0.32)) continue
          const t = clearance + (usable * (i + 0.5)) / count
          for (const side of [-1, 1]) {
            if (treeRng.chance(0.25)) continue
            const ax = lineX + t
            const az = lineZ + side * verge
            if (!blocksAPickup(ax, az)) trees.push(this.#makeTree(treeRng, ax, az))

            const bx2 = lineX + side * verge
            const bz2 = lineZ + t
            if (!blocksAPickup(bx2, bz2)) trees.push(this.#makeTree(treeRng, bx2, bz2))
          }
        }
      }
    }

    for (const b of buildings) {
      const swapped = Math.round(b.rotation / (Math.PI / 2)) % 2 === 1
      obstacles.push({
        x: b.x,
        y: b.z,
        kind: 'building',
        hw: (swapped ? b.depth : b.width) / 2,
        hh: (swapped ? b.width : b.depth) / 2,
        r: 0,
      })
    }
    for (const t of trees) {
      obstacles.push({ x: t.x, y: t.z, kind: 'tree', hw: 0, hh: 0, r: t.scale * 0.3 })
    }

    return { cx, cz, buildings, trees, sidewalkSpots: spots, obstacles }
  }

  #makeTree(rng: Rng, x: number, z: number): TreePlacement {
    return {
      x,
      z,
      scale: rng.range(0.85, 1.5),
      rotation: rng.range(0, Math.PI * 2),
      conifer: rng.chance(0.3),
      colorIndex: rng.int(0, FOLIAGE_COLORS.length - 1),
    }
  }

  // -------------------------------------------------------------- instancing

  /**
   * Rewrite every instance buffer from the currently loaded chunks.
   *
   * Runs only on a chunk-boundary crossing. Everything is written into fixed
   * pools, so the number of draw calls is identical whether one chunk is
   * loaded or a hundred.
   */
  #rebuildInstances(): void {
    let b = 0
    let cap = 0
    let roof = 0
    let trunk = 0
    let blob = 0
    let cone = 0

    this.obstacles.clear()
    for (const ob of this.#staticObstacles) this.obstacles.insert(ob)
    this.#spots = []

    const bMax = this.#buildingMesh.instanceMatrix.count
    const capMax = this.#capMesh.instanceMatrix.count
    const roofMax = this.#roofMesh.instanceMatrix.count
    const tMax = this.#trunkMesh.instanceMatrix.count

    for (const chunk of this.#chunks.values()) {
      for (const spot of chunk.sidewalkSpots) this.#spots.push(spot)
      for (const ob of chunk.obstacles) this.obstacles.insert(ob)

      for (const p of chunk.buildings) {
        if (b >= bMax) break
        this.#quat.setFromAxisAngle(AXIS_Y, p.rotation)

        const bodyHeight =
          p.form === 'setback'
            ? p.height * p.setbackRatio
            : p.form === 'pitched'
              ? p.height * 0.86
              : p.height

        this.#pos.set(p.x, bodyHeight / 2, p.z)
        this.#scale.set(p.width, bodyHeight, p.depth)
        this.#matrix.compose(this.#pos, this.#quat, this.#scale)
        this.#buildingMesh.setMatrixAt(b, this.#matrix)
        this.#buildingMesh.setColorAt(b, this.#buildingColors[p.colorIndex]!)
        b++

        const roofColor = this.#roofColors[p.roofIndex]!

        if (p.form === 'setback' && cap < capMax && b < bMax) {
          // The upper storey goes through the BUILDING pool, not the trim
          // pool: it is a tower, and it should carry the same windows and
          // taper as the block underneath it rather than reading as a
          // featureless slab sitting on the roof.
          const upper = p.height - bodyHeight
          const inset = 1 - p.setbackInset
          this.#pos.set(p.x, bodyHeight + upper / 2, p.z)
          this.#scale.set(p.width * inset, upper, p.depth * inset)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#buildingMesh.setMatrixAt(b, this.#matrix)
          this.#buildingMesh.setColorAt(b, this.#buildingColors[p.colorIndex]!)
          b++

          this.#pos.set(p.x, bodyHeight + 0.14, p.z)
          this.#scale.set(p.width * 1.04, 0.28, p.depth * 1.04)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#capMesh.setMatrixAt(cap, this.#matrix)
          this.#capMesh.setColorAt(cap, roofColor)
          cap++
        } else if (p.form === 'pitched' && roof < roofMax && cap < capMax) {
          const rh = p.height * 0.28
          this.#pos.set(p.x, bodyHeight, p.z)
          this.#scale.set(p.width * 1.07, rh, p.depth * 1.07)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#roofMesh.setMatrixAt(roof, this.#matrix)
          this.#roofMesh.setColorAt(roof, roofColor)
          roof++

          this.#pos.set(p.x, bodyHeight - 0.06, p.z)
          this.#scale.set(p.width * 1.09, 0.14, p.depth * 1.09)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#capMesh.setMatrixAt(cap, this.#matrix)
          this.#capMesh.setColorAt(cap, roofColor)
          cap++
        } else if (cap < capMax) {
          this.#pos.set(p.x, p.height + 0.16, p.z)
          this.#scale.set(p.width * 1.03, 0.32, p.depth * 1.03)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#capMesh.setMatrixAt(cap, this.#matrix)
          this.#capMesh.setColorAt(cap, roofColor)
          cap++
        }
      }

      for (const t of chunk.trees) {
        if (trunk >= tMax) break
        const trunkHeight = t.scale * (t.conifer ? 0.7 : 1.0)
        this.#quat.setFromAxisAngle(AXIS_Y, t.rotation)
        this.#pos.set(t.x, trunkHeight / 2, t.z)
        this.#scale.set(t.scale, trunkHeight, t.scale)
        this.#matrix.compose(this.#pos, this.#quat, this.#scale)
        this.#trunkMesh.setMatrixAt(trunk, this.#matrix)
        trunk++

        const color = this.#foliageColors[t.colorIndex]!
        if (t.conifer) {
          if (cone >= tMax) continue
          this.#pos.set(t.x, t.scale * 0.7 + t.scale * 0.8, t.z)
          this.#scale.setScalar(t.scale)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#coneMesh.setMatrixAt(cone, this.#matrix)
          this.#coneMesh.setColorAt(cone, color)
          cone++
        } else {
          if (blob >= tMax) continue
          this.#pos.set(t.x, t.scale * 1.42, t.z)
          this.#scale.set(t.scale, t.scale * 0.95, t.scale)
          this.#matrix.compose(this.#pos, this.#quat, this.#scale)
          this.#blobMesh.setMatrixAt(blob, this.#matrix)
          this.#blobMesh.setColorAt(blob, color)
          blob++
        }
      }
    }

    this.#rebuildRoads()

    const finish = (mesh: InstancedMesh, count: number): void => {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    finish(this.#buildingMesh, b)
    finish(this.#capMesh, cap)
    finish(this.#roofMesh, roof)
    finish(this.#trunkMesh, trunk)
    finish(this.#blobMesh, blob)
    finish(this.#coneMesh, cone)
    this.#quat.identity()
  }

  /** Lay road and kerb quads along every gridline in the loaded area. */
  #rebuildRoads(): void {
    let road = 0
    let kerb = 0
    const max = this.#roadMesh.instanceMatrix.count

    let minBlockX = Infinity
    let maxBlockX = -Infinity
    let minBlockZ = Infinity
    let maxBlockZ = -Infinity
    for (const c of this.#chunks.values()) {
      minBlockX = Math.min(minBlockX, c.cx * BLOCKS_PER_CHUNK)
      maxBlockX = Math.max(maxBlockX, (c.cx + 1) * BLOCKS_PER_CHUNK)
      minBlockZ = Math.min(minBlockZ, c.cz * BLOCKS_PER_CHUNK)
      maxBlockZ = Math.max(maxBlockZ, (c.cz + 1) * BLOCKS_PER_CHUNK)
    }
    if (!Number.isFinite(minBlockX)) return

    const spanX = (maxBlockX - minBlockX) * BLOCK_SIZE
    const spanZ = (maxBlockZ - minBlockZ) * BLOCK_SIZE
    const midX = ((minBlockX + maxBlockX) / 2) * BLOCK_SIZE
    const midZ = ((minBlockZ + maxBlockZ) / 2) * BLOCK_SIZE

    // One long quad per gridline rather than one per block: far fewer
    // instances, and no seams between adjacent pieces.
    const lay = (
      mesh: InstancedMesh,
      index: number,
      x: number,
      z: number,
      w: number,
      d: number,
      y: number,
    ): void => {
      this.#quat.setFromAxisAngle(AXIS_X, -Math.PI / 2)
      this.#pos.set(x, y, z)
      this.#scale.set(w, d, 1)
      this.#matrix.compose(this.#pos, this.#quat, this.#scale)
      mesh.setMatrixAt(index, this.#matrix)
    }

    for (let bz = minBlockZ; bz <= maxBlockZ; bz++) {
      if (road >= max) break
      const z = bz * BLOCK_SIZE
      lay(this.#kerbMesh, kerb++, midX, z, spanX, PAVED_WIDTH, KERB_HEIGHT)
      lay(this.#roadMesh, road++, midX, z, spanX, ROAD_WIDTH, KERB_HEIGHT + ROAD_HEIGHT)
    }
    for (let bx = minBlockX; bx <= maxBlockX; bx++) {
      if (road >= max) break
      const x = bx * BLOCK_SIZE
      lay(this.#kerbMesh, kerb++, x, midZ, PAVED_WIDTH, spanZ, KERB_HEIGHT)
      lay(this.#roadMesh, road++, x, midZ, ROAD_WIDTH, spanZ, KERB_HEIGHT + ROAD_HEIGHT)
    }

    this.#roadMesh.count = road
    this.#kerbMesh.count = kerb
    this.#roadMesh.instanceMatrix.needsUpdate = true
    this.#kerbMesh.instanceMatrix.needsUpdate = true
    this.#quat.identity()
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose()
    this.root.traverse((o) => {
      if (o instanceof InstancedMesh) o.dispose()
    })
    this.root.clear()
    this.#chunks.clear()
  }
}

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)

export { BLOCK_SIZE, CHUNK_SIZE, PAVED_WIDTH, ROAD_WIDTH }
