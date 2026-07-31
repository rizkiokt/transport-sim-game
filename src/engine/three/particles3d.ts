/**
 * Pooled 3D particles.
 *
 * One `InstancedMesh` draws the whole system in a single call, so a
 * celebration burst of two hundred confetti pieces costs about the same as
 * one cube. State lives in flat typed arrays and the pool never grows after
 * construction — a child mashing the horn must not trigger a GC pause.
 *
 * Particles are camera-facing quads by default (cheap and reads well for
 * sparks and smoke) or small boxes for confetti, chosen at construction.
 */

import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from 'three'

import { cosmeticRng } from '../math/rng.js'

export interface EmitOptions3D {
  x: number
  y: number
  z: number
  count?: number
  /** Base velocity. */
  vx?: number
  vy?: number
  vz?: number
  /** Random speed added in a random direction within the cone. */
  speedMin?: number
  speedMax?: number
  /** Cone half-angle from straight up, radians. PI = full sphere. */
  spread?: number
  /** Bias the cone's axis; defaults to straight up. */
  dirX?: number
  dirY?: number
  dirZ?: number
  lifeMin?: number
  lifeMax?: number
  sizeMin?: number
  sizeMax?: number
  /** Size multiplier at death. */
  sizeEnd?: number
  /** Gravity, world units/s². Negative falls. */
  gravity?: number
  /** Per-second velocity retention. 1 = none. */
  drag?: number
  colors?: readonly number[]
  spinMin?: number
  spinMax?: number
  /** Jitter spawn positions within this radius. */
  spawnRadius?: number
}

export class ParticleSystem3D {
  readonly capacity: number
  readonly mesh: InstancedMesh

  /** Global emission multiplier; the quality tier and reduced-motion set this. */
  intensity = 1

  readonly #px: Float32Array
  readonly #py: Float32Array
  readonly #pz: Float32Array
  readonly #vx: Float32Array
  readonly #vy: Float32Array
  readonly #vz: Float32Array
  readonly #life: Float32Array
  readonly #maxLife: Float32Array
  readonly #size: Float32Array
  readonly #sizeEnd: Float32Array
  readonly #gravity: Float32Array
  readonly #drag: Float32Array
  readonly #spinX: Float32Array
  readonly #spinY: Float32Array
  readonly #rotX: Float32Array
  readonly #rotY: Float32Array
  /**
   * Colour per particle, as r/g/b triples indexed by pool slot.
   *
   * Kept here rather than written straight to the instance buffer because
   * live particles are compacted into a contiguous prefix each frame: a
   * particle's pool index and its draw slot are different numbers, so the
   * colour has to be re-written to the draw slot alongside its matrix.
   */
  readonly #rgb: Float32Array

  readonly #free: Uint32Array
  #freeCount: number
  readonly #live: Uint32Array
  #liveCount = 0

  readonly #material: Material

  // Scratch, reused every frame.
  readonly #matrix = new Matrix4()
  readonly #pos = new Vector3()
  readonly #quat = new Quaternion()
  readonly #scale = new Vector3()
  readonly #euler = new Object3D()
  readonly #color = new Color()

  constructor(capacity = 600, options: { lit?: boolean } = {}) {
    this.capacity = capacity

    // A low-poly icosahedron rather than a box: 20 triangles instead of 12,
    // but it reads as a soft chunk from any angle. Boxes are unmistakably
    // boxes when they tumble, which makes smoke look like falling crates.
    const geometry = new IcosahedronGeometry(0.62, 0)
    this.#material = options.lit
      ? new MeshLambertMaterial({ transparent: true, opacity: 1, depthWrite: false })
      : new MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false })

    this.mesh = new InstancedMesh(geometry, this.#material, capacity)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    // Start with every instance collapsed to nothing.
    this.mesh.count = 0

    const f32 = (): Float32Array => new Float32Array(capacity)
    this.#px = f32()
    this.#py = f32()
    this.#pz = f32()
    this.#vx = f32()
    this.#vy = f32()
    this.#vz = f32()
    this.#life = f32()
    this.#maxLife = f32()
    this.#size = f32()
    this.#sizeEnd = f32()
    this.#gravity = f32()
    this.#drag = f32()
    this.#spinX = f32()
    this.#spinY = f32()
    this.#rotX = f32()
    this.#rotY = f32()
    this.#rgb = new Float32Array(capacity * 3)

    this.#free = new Uint32Array(capacity)
    this.#live = new Uint32Array(capacity)
    for (let i = 0; i < capacity; i++) this.#free[i] = capacity - 1 - i
    this.#freeCount = capacity
  }

  get liveCount(): number {
    return this.#liveCount
  }

  emit(options: EmitOptions3D): void {
    if (this.intensity <= 0) return
    const requested = Math.round((options.count ?? 8) * this.intensity)
    if (requested <= 0) return

    const rng = cosmeticRng
    const colors = options.colors ?? DEFAULT_COLORS
    const speedMin = options.speedMin ?? 0
    const speedMax = options.speedMax ?? speedMin
    const lifeMin = options.lifeMin ?? 0.6
    const lifeMax = options.lifeMax ?? lifeMin
    const sizeMin = options.sizeMin ?? 0.08
    const sizeMax = options.sizeMax ?? sizeMin
    const spinMin = options.spinMin ?? 0
    const spinMax = options.spinMax ?? spinMin
    const spread = options.spread ?? Math.PI
    const spawnRadius = options.spawnRadius ?? 0

    // Normalise the cone axis, defaulting to straight up.
    let ax = options.dirX ?? 0
    let ay = options.dirY ?? 1
    let az = options.dirZ ?? 0
    const axLen = Math.hypot(ax, ay, az) || 1
    ax /= axLen
    ay /= axLen
    az /= axLen

    for (let n = 0; n < requested; n++) {
      const i = this.#allocate()
      if (i < 0) break

      let sx = options.x
      let sy = options.y
      let sz = options.z
      if (spawnRadius > 0) {
        const p = rng.insideCircle()
        sx += p.x * spawnRadius
        sz += p.y * spawnRadius
        sy += rng.range(-spawnRadius * 0.3, spawnRadius * 0.3)
      }

      // Sample a direction within the cone around the axis.
      const cosTheta = Math.cos(spread)
      const u = rng.range(cosTheta, 1)
      const phi = rng.range(0, Math.PI * 2)
      const sinTheta = Math.sqrt(Math.max(0, 1 - u * u))

      // Build a basis around the axis so the cone points the right way.
      let ux = 0
      let uy = 0
      let uz = 1
      if (Math.abs(az) > 0.9) {
        ux = 1
        uz = 0
      }
      // t1 = normalize(cross(axis, up)); t2 = cross(axis, t1)
      let t1x = ay * uz - az * uy
      let t1y = az * ux - ax * uz
      let t1z = ax * uy - ay * ux
      const t1Len = Math.hypot(t1x, t1y, t1z) || 1
      t1x /= t1Len
      t1y /= t1Len
      t1z /= t1Len
      const t2x = ay * t1z - az * t1y
      const t2y = az * t1x - ax * t1z
      const t2z = ax * t1y - ay * t1x

      const cx = Math.cos(phi) * sinTheta
      const cy = Math.sin(phi) * sinTheta
      const dirX = ax * u + t1x * cx + t2x * cy
      const dirY = ay * u + t1y * cx + t2y * cy
      const dirZ = az * u + t1z * cx + t2z * cy

      const speed = rng.range(speedMin, speedMax)

      this.#px[i] = sx
      this.#py[i] = sy
      this.#pz[i] = sz
      this.#vx[i] = (options.vx ?? 0) + dirX * speed
      this.#vy[i] = (options.vy ?? 0) + dirY * speed
      this.#vz[i] = (options.vz ?? 0) + dirZ * speed

      const life = rng.range(lifeMin, lifeMax)
      this.#life[i] = life
      this.#maxLife[i] = life
      this.#size[i] = rng.range(sizeMin, sizeMax)
      this.#sizeEnd[i] = options.sizeEnd ?? 0.1
      this.#gravity[i] = options.gravity ?? -9.8
      this.#drag[i] = options.drag ?? 1
      this.#spinX[i] = rng.range(spinMin, spinMax)
      this.#spinY[i] = rng.range(spinMin, spinMax)
      this.#rotX[i] = rng.range(0, Math.PI * 2)
      this.#rotY[i] = rng.range(0, Math.PI * 2)

      this.#color.setHex(colors[Math.floor(rng.next() * colors.length)] ?? 0xffffff)
      this.#rgb[i * 3] = this.#color.r
      this.#rgb[i * 3 + 1] = this.#color.g
      this.#rgb[i * 3 + 2] = this.#color.b
    }
  }

  update(dt: number): void {
    let write = 0

    for (let n = 0; n < this.#liveCount; n++) {
      const i = this.#live[n]!

      const life = this.#life[i]! - dt
      if (life <= 0) {
        this.#free[this.#freeCount++] = i
        continue
      }
      this.#life[i] = life

      const drag = this.#drag[i]!
      if (drag !== 1) {
        const factor = Math.pow(drag, dt)
        this.#vx[i]! *= factor
        this.#vy[i]! *= factor
        this.#vz[i]! *= factor
      }

      this.#vy[i]! += this.#gravity[i]! * dt
      this.#px[i]! += this.#vx[i]! * dt
      this.#py[i]! += this.#vy[i]! * dt
      this.#pz[i]! += this.#vz[i]! * dt
      this.#rotX[i]! += this.#spinX[i]! * dt
      this.#rotY[i]! += this.#spinY[i]! * dt

      // Particles that fall through the ground stop there rather than sinking.
      if (this.#py[i]! < 0.02) {
        this.#py[i] = 0.02
        this.#vy[i] = 0
        this.#vx[i]! *= 0.7
        this.#vz[i]! *= 0.7
      }

      this.#live[write++] = i
    }

    this.#liveCount = write
    this.#writeMatrices()
  }

  #writeMatrices(): void {
    for (let n = 0; n < this.#liveCount; n++) {
      const i = this.#live[n]!
      const t = 1 - this.#life[i]! / this.#maxLife[i]!
      const size = this.#size[i]! * (1 + (this.#sizeEnd[i]! - 1) * t)

      this.#pos.set(this.#px[i]!, this.#py[i]!, this.#pz[i]!)
      this.#euler.rotation.set(this.#rotX[i]!, this.#rotY[i]!, 0)
      this.#quat.setFromEuler(this.#euler.rotation)
      this.#scale.setScalar(Math.max(0.0001, size))
      this.#matrix.compose(this.#pos, this.#quat, this.#scale)
      // Write into draw slot n, not pool slot i: InstancedMesh draws the
      // first `count` instances, so live particles must occupy a contiguous
      // prefix. The colour has to follow the matrix into the same slot.
      this.mesh.setMatrixAt(n, this.#matrix)
      this.#color.setRGB(this.#rgb[i * 3]!, this.#rgb[i * 3 + 1]!, this.#rgb[i * 3 + 2]!)
      this.mesh.setColorAt(n, this.#color)
    }

    this.mesh.count = this.#liveCount
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  clear(): void {
    for (let n = 0; n < this.#liveCount; n++) this.#free[this.#freeCount++] = this.#live[n]!
    this.#liveCount = 0
    this.mesh.count = 0
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.#material.dispose()
    this.mesh.dispose()
  }

  #allocate(): number {
    if (this.#freeCount > 0) {
      const i = this.#free[--this.#freeCount]!
      this.#live[this.#liveCount++] = i
      return i
    }
    if (this.#liveCount === 0) return -1
    // Pool exhausted: recycle the oldest.
    const stolen = this.#live[0]!
    this.#live.copyWithin(0, 1, this.#liveCount)
    this.#live[this.#liveCount - 1] = stolen
    return stolen
  }
}

const DEFAULT_COLORS = [0xffffff] as const
