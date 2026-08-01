/**
 * Procedural textures.
 *
 * The single biggest reason untextured 3D reads as "toy" is that real
 * surfaces are never one flat colour. Asphalt has aggregate, wear and patched
 * repairs; concrete has staining and form marks; brick has mortar lines and
 * per-brick colour variation. Lighting cannot rescue a surface with no detail
 * in it — a perfectly lit flat colour still looks like plastic.
 *
 * Everything here is drawn to a canvas at load time and uploaded as a
 * texture, so the game keeps its no-asset-files constraint: nothing is
 * fetched, and a full material set costs a few hundred KB of VRAM rather than
 * megabytes of downloads.
 *
 * Each generator returns a **height field** as well as a colour map, and
 * {@link heightToNormalMap} converts that to a normal map with a Sobel
 * filter. Normal maps are what actually catch the light — they are the
 * difference between a photograph of a road and a grey rectangle.
 */

import {
  CanvasTexture,
  DataTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Material,
  type Texture,
} from 'three'

import { createRng, type Rng } from '../math/rng.js'

export interface SurfaceMaps {
  /** Base colour. sRGB. */
  map: Texture
  /** Tangent-space normals, derived from the height field. */
  normalMap: Texture
  /** Per-texel roughness. Linear. */
  roughnessMap: Texture
  dispose(): void
}

/** Everything is generated at this resolution unless told otherwise. */
const DEFAULT_SIZE = 512

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('textures: could not acquire a 2D context')
  return { canvas, ctx }
}

function finishColor(canvas: HTMLCanvasElement, repeat: number): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

function finishLinear(canvas: HTMLCanvasElement, repeat: number): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/**
 * Convert a greyscale height field into a tangent-space normal map.
 *
 * Uses a Sobel operator on the height, sampled with wraparound so the result
 * tiles seamlessly. `strength` scales the apparent relief: 1 is subtle
 * surface tooth, 4 is heavily pitted.
 */
export function heightToNormalMap(
  height: Float32Array,
  size: number,
  strength = 2,
  repeat = 1,
): DataTexture {
  const data = new Uint8Array(size * size * 4)
  const at = (x: number, y: number): number => {
    // Wrap so the normal map tiles as seamlessly as the height did.
    const wx = ((x % size) + size) % size
    const wy = ((y % size) + size) % size
    return height[wy * size + wx] ?? 0
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel in both axes.
      const tl = at(x - 1, y - 1)
      const t = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const l = at(x - 1, y)
      const r = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const b = at(x, y + 1)
      const br = at(x + 1, y + 1)

      const dx = tl + 2 * l + bl - (tr + 2 * r + br)
      const dy = tl + 2 * t + tr - (bl + 2 * b + br)

      // Build the normal and renormalise into 0..255.
      let nx = dx * strength
      let ny = dy * strength
      const nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len

      const i = (y * size + x) * 4
      data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/** Value noise sampled on a grid, smoothed — the base for every surface here. */
function valueNoiseField(size: number, cells: number, rng: Rng): Float32Array {
  const grid = new Float32Array((cells + 1) * (cells + 1))
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next()

  // Make the grid wrap, so the resulting field tiles.
  for (let i = 0; i <= cells; i++) {
    grid[i * (cells + 1) + cells] = grid[i * (cells + 1)]!
    grid[cells * (cells + 1) + i] = grid[i]!
  }

  const out = new Float32Array(size * size)
  const scale = cells / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * scale
      const fy = y * scale
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      // Smoothstep for a soft, blobby field rather than a linear diamond mesh.
      const sx = tx * tx * (3 - 2 * tx)
      const sy = ty * ty * (3 - 2 * ty)

      const a = grid[y0 * (cells + 1) + x0]!
      const b = grid[y0 * (cells + 1) + x0 + 1]!
      const c = grid[(y0 + 1) * (cells + 1) + x0]!
      const d = grid[(y0 + 1) * (cells + 1) + x0 + 1]!

      const top = a + (b - a) * sx
      const bottom = c + (d - c) * sx
      out[y * size + x] = top + (bottom - top) * sy
    }
  }
  return out
}

/** Sum several octaves of value noise. Higher octaves add fine detail. */
function fbm(size: number, baseCells: number, octaves: number, rng: Rng): Float32Array {
  const out = new Float32Array(size * size)
  let amplitude = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoiseField(size, baseCells * 2 ** o, rng)
    for (let i = 0; i < out.length; i++) out[i]! += layer[i]! * amplitude
    total += amplitude
    amplitude *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total
  return out
}

/**
 * Asphalt: dark, with visible aggregate, subtle lightening from tyre polish,
 * and occasional darker patch repairs.
 */
export function createAsphalt(size = DEFAULT_SIZE, repeat = 6): SurfaceMaps {
  const rng = createRng('asphalt')
  const { canvas, ctx } = makeCanvas(size)
  const { canvas: roughCanvas, ctx: roughCtx } = makeCanvas(size)

  const height = new Float32Array(size * size)

  // Base tone, plus a broad blotchiness so it never reads as flat grey.
  const broad = fbm(size, 4, 3, rng)
  const grain = fbm(size, 64, 2, rng)

  const image = ctx.createImageData(size, size)
  const rough = roughCtx.createImageData(size, size)

  for (let i = 0; i < size * size; i++) {
    // Aggregate: fine high-frequency speckle is what makes tarmac read as
    // tarmac rather than as dark paper.
    const speck = rng.next()
    const stone = speck > 0.986 ? rng.range(0.35, 0.6) : 0

    const value = 0.17 + broad[i]! * 0.07 + grain[i]! * 0.06 + stone
    const v = Math.max(0, Math.min(1, value))
    const byte = Math.round(v * 255)

    const p = i * 4
    // A very slight blue-grey cast; pure neutral grey looks synthetic.
    image.data[p] = byte
    image.data[p + 1] = byte + 2
    image.data[p + 2] = byte + 6
    image.data[p + 3] = 255

    // Stones sit proud; the binder between them sits low.
    height[i] = v * 0.6 + (stone > 0 ? 0.4 : 0)

    // Polished wheel tracks are smoother than the surrounding surface.
    const r = Math.round((0.72 + grain[i]! * 0.2 - stone * 0.3) * 255)
    rough.data[p] = r
    rough.data[p + 1] = r
    rough.data[p + 2] = r
    rough.data[p + 3] = 255
  }

  ctx.putImageData(image, 0, 0)
  roughCtx.putImageData(rough, 0, 0)

  return {
    map: finishColor(canvas, repeat),
    normalMap: heightToNormalMap(height, size, 1.4, repeat),
    roughnessMap: finishLinear(roughCanvas, repeat),
    dispose(): void {
      this.map.dispose()
      this.normalMap.dispose()
      this.roughnessMap.dispose()
    },
  }
}

/**
 * Grass: mottled green with clumping, and enough height variation that the
 * light catches it rather than presenting a flat plane.
 */
export function createGrass(size = DEFAULT_SIZE, repeat = 24): SurfaceMaps {
  const rng = createRng('grass')
  const { canvas, ctx } = makeCanvas(size)
  const { canvas: roughCanvas, ctx: roughCtx } = makeCanvas(size)

  const clump = fbm(size, 6, 3, rng)
  const blade = fbm(size, 48, 2, rng)
  const height = new Float32Array(size * size)

  const image = ctx.createImageData(size, size)
  const rough = roughCtx.createImageData(size, size)

  for (let i = 0; i < size * size; i++) {
    const t = clump[i]! * 0.65 + blade[i]! * 0.35
    // Vary hue as well as brightness: real turf shifts yellow-green to
    // blue-green in patches, and brightness alone reads as a shadow map.
    const r = 0.29 + t * 0.22
    const g = 0.46 + t * 0.26
    const b = 0.2 + t * 0.14

    const p = i * 4
    image.data[p] = Math.round(r * 255)
    image.data[p + 1] = Math.round(g * 255)
    image.data[p + 2] = Math.round(b * 255)
    image.data[p + 3] = 255

    height[i] = blade[i]! * 0.8 + clump[i]! * 0.2

    const rv = Math.round((0.86 + blade[i]! * 0.12) * 255)
    rough.data[p] = rv
    rough.data[p + 1] = rv
    rough.data[p + 2] = rv
    rough.data[p + 3] = 255
  }

  ctx.putImageData(image, 0, 0)
  roughCtx.putImageData(rough, 0, 0)

  return {
    map: finishColor(canvas, repeat),
    normalMap: heightToNormalMap(height, size, 2.4, repeat),
    roughnessMap: finishLinear(roughCanvas, repeat),
    dispose(): void {
      this.map.dispose()
      this.normalMap.dispose()
      this.roughnessMap.dispose()
    },
  }
}

/**
 * Concrete paving, for kerbs and footways: pale, blotchy, with form marks and
 * a shallow slab joint grid.
 */
export function createConcrete(size = DEFAULT_SIZE, repeat = 8): SurfaceMaps {
  const rng = createRng('concrete')
  const { canvas, ctx } = makeCanvas(size)
  const { canvas: roughCanvas, ctx: roughCtx } = makeCanvas(size)

  const stain = fbm(size, 5, 4, rng)
  const grain = fbm(size, 96, 1, rng)
  const height = new Float32Array(size * size)

  const image = ctx.createImageData(size, size)
  const rough = roughCtx.createImageData(size, size)

  // Slab joints every quarter of the tile.
  const jointEvery = size / 4
  const jointWidth = Math.max(1, size / 220)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const p = i * 4

      const nearJointX = Math.min(x % jointEvery, jointEvery - (x % jointEvery))
      const nearJointY = Math.min(y % jointEvery, jointEvery - (y % jointEvery))
      const inJoint = nearJointX < jointWidth || nearJointY < jointWidth

      const base = 0.62 + stain[i]! * 0.16 + grain[i]! * 0.05
      const v = Math.max(0, Math.min(1, inJoint ? base * 0.72 : base))
      const byte = Math.round(v * 255)

      // Slightly warm; cool grey concrete reads as metal.
      image.data[p] = byte + 6
      image.data[p + 1] = byte + 3
      image.data[p + 2] = byte - 4
      image.data[p + 3] = 255

      height[i] = inJoint ? 0.1 : 0.5 + grain[i]! * 0.5
      const rv = Math.round((0.8 + stain[i]! * 0.15) * 255)
      rough.data[p] = rv
      rough.data[p + 1] = rv
      rough.data[p + 2] = rv
      rough.data[p + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  roughCtx.putImageData(rough, 0, 0)

  return {
    map: finishColor(canvas, repeat),
    normalMap: heightToNormalMap(height, size, 2, repeat),
    roughnessMap: finishLinear(roughCanvas, repeat),
    dispose(): void {
      this.map.dispose()
      this.normalMap.dispose()
      this.roughnessMap.dispose()
    },
  }
}

/**
 * A generic wall surface for buildings: fine plaster tooth plus broad
 * weathering, tinted white so per-instance colour can multiply through it.
 *
 * Deliberately colour-neutral. The buildings are instanced with per-instance
 * colours, so the texture must not fight them — it supplies detail, and the
 * instance supplies hue.
 */
export function createWall(size = DEFAULT_SIZE, repeat = 3): SurfaceMaps {
  const rng = createRng('wall')
  const { canvas, ctx } = makeCanvas(size)
  const { canvas: roughCanvas, ctx: roughCtx } = makeCanvas(size)

  const weather = fbm(size, 4, 4, rng)
  const tooth = fbm(size, 128, 1, rng)
  const height = new Float32Array(size * size)

  const image = ctx.createImageData(size, size)
  const rough = roughCtx.createImageData(size, size)

  for (let i = 0; i < size * size; i++) {
    // Centred near white so multiplying by the instance colour lands close to
    // the intended hue, with detail riding on top.
    const v = Math.max(0, Math.min(1, 0.86 + weather[i]! * 0.14 + tooth[i]! * 0.06 - 0.08))
    const byte = Math.round(v * 255)
    const p = i * 4
    image.data[p] = byte
    image.data[p + 1] = byte
    image.data[p + 2] = byte
    image.data[p + 3] = 255

    height[i] = tooth[i]! * 0.7 + weather[i]! * 0.3
    const rv = Math.round((0.82 + weather[i]! * 0.16) * 255)
    rough.data[p] = rv
    rough.data[p + 1] = rv
    rough.data[p + 2] = rv
    rough.data[p + 3] = 255
  }

  ctx.putImageData(image, 0, 0)
  roughCtx.putImageData(rough, 0, 0)

  return {
    map: finishColor(canvas, repeat),
    normalMap: heightToNormalMap(height, size, 1.1, repeat),
    roughnessMap: finishLinear(roughCanvas, repeat),
    dispose(): void {
      this.map.dispose()
      this.normalMap.dispose()
      this.roughnessMap.dispose()
    },
  }
}

/**
 * Make a material take its UVs from world position rather than from the mesh.
 *
 * Ground surfaces here are instanced boxes of wildly different sizes — a road
 * segment is 20 units long and a kerb is 8 wide, but every instance shares one
 * unit-cube geometry whose UVs run 0..1. Sampled normally, the asphalt would
 * be stretched twenty times along one segment and squashed on the next, and
 * the seams between them would be obvious.
 *
 * Deriving the UV from world X/Z instead gives every surface the same texel
 * density regardless of its size, and makes neighbouring pieces line up
 * exactly — which is what lets separate road and junction boxes read as one
 * continuous road.
 *
 * Only valid for roughly horizontal surfaces: it projects straight down, so
 * a vertical face would smear. That is fine for ground, roads and kerbs.
 *
 * @param scale world units per texture tile
 */
export function applyWorldUV(material: Material, scale = 0.25): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWorldUv;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        {
          // Uses position, not transformed: this chunk runs before
          // begin_vertex defines transformed.
          vec4 worldPos = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            worldPos = instanceMatrix * worldPos;
          #endif
          worldPos = modelMatrix * worldPos;
          vWorldUv = worldPos.xz * ${scale.toFixed(4)};

          // Redirect each map's UV varying at the world-space one and leave
          // Three's own sampling chunks completely untouched. Rewriting the
          // fragment-side chunks instead means reimplementing their
          // object-space/packed-normal branches, which is how the road
          // silently stopped rendering the first time this was tried.
          #ifdef USE_MAP
            vMapUv = vWorldUv;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = vWorldUv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = vWorldUv;
          #endif
        }`,
      )

  }

  // Distinct cache key, or Three reuses an unpatched program compiled from
  // the same base material type.
  material.customProgramCacheKey = () => `world-uv-${scale}`
}

/**
 * The full surface set, built once and shared.
 *
 * Generation is a few hundred milliseconds of canvas work at 512px, so it
 * happens once at startup rather than per material. `size` is dropped on the
 * low quality tier, where texture memory and upload cost matter more than
 * fine detail.
 */
export class SurfaceLibrary {
  readonly asphalt: SurfaceMaps
  readonly grass: SurfaceMaps
  readonly concrete: SurfaceMaps
  readonly wall: SurfaceMaps

  constructor(size = DEFAULT_SIZE) {
    this.asphalt = createAsphalt(size)
    this.grass = createGrass(size)
    this.concrete = createConcrete(size)
    this.wall = createWall(size)
  }

  dispose(): void {
    this.asphalt.dispose()
    this.grass.dispose()
    this.concrete.dispose()
    this.wall.dispose()
  }
}
