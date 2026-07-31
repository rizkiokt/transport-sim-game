/**
 * The city map.
 *
 * A small top-down canvas in the corner showing the road grid, where the car
 * is, which way it is pointing, and where the current passenger or
 * destination is.
 *
 * This solves a real problem the 3D view created: from a chase camera at
 * street level you cannot see over the buildings, so a destination two blocks
 * away is completely hidden. The compass says *which way*, but only a map
 * says *how the roads get you there* — and a 6-year-old planning a route
 * around a block is doing something genuinely satisfying.
 *
 * The static road grid is drawn once into an offscreen canvas and blitted
 * each frame; only the three moving dots are redrawn. That keeps the whole
 * thing to one image copy and a few arcs per frame.
 */

import type { RoadNetwork } from '../world/road-network.js'

export interface MinimapOptions {
  /** World-space extent the map covers. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  roads: RoadNetwork
  /** World units per layout unit, matching the city's WORLD_SCALE. */
  worldScale: number
  /** On-screen size in CSS pixels. */
  size?: number
}

export class Minimap {
  readonly element: HTMLDivElement

  readonly #canvas: HTMLCanvasElement
  readonly #ctx: CanvasRenderingContext2D
  /** Pre-rendered road grid; never changes. */
  readonly #base: HTMLCanvasElement

  readonly #bounds: MinimapOptions['bounds']
  readonly #size: number
  readonly #dpr: number

  /** World -> map pixel scale, and the letterbox offsets that centre it. */
  readonly #scale: number
  readonly #offsetX: number
  readonly #offsetY: number

  constructor(container: HTMLElement, options: MinimapOptions) {
    this.#bounds = options.bounds
    this.#size = options.size ?? 150
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2)

    const worldWidth = options.bounds.maxX - options.bounds.minX
    const worldDepth = options.bounds.maxZ - options.bounds.minZ
    // Fit the whole town, preserving aspect, with a small inset.
    this.#scale = (this.#size * 0.92) / Math.max(worldWidth, worldDepth)
    this.#offsetX = (this.#size - worldWidth * this.#scale) / 2
    this.#offsetY = (this.#size - worldDepth * this.#scale) / 2

    this.element = document.createElement('div')
    this.element.className = 'minimap'

    this.#canvas = document.createElement('canvas')
    this.#canvas.width = this.#size * this.#dpr
    this.#canvas.height = this.#size * this.#dpr
    this.#canvas.style.width = `${this.#size}px`
    this.#canvas.style.height = `${this.#size}px`
    this.element.appendChild(this.#canvas)
    container.appendChild(this.element)

    const ctx = this.#canvas.getContext('2d')
    if (!ctx) throw new Error('Minimap: could not acquire a 2D context')
    this.#ctx = ctx

    this.#base = this.#renderBase(options.roads, options.worldScale)
  }

  /** Draw the moving parts. Call once per frame. */
  update(
    car: { x: number; z: number; heading: number },
    target: { x: number; z: number; color: number } | null,
  ): void {
    const ctx = this.#ctx
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    ctx.clearRect(0, 0, this.#size, this.#size)
    ctx.drawImage(this.#base, 0, 0, this.#size, this.#size)

    // Destination or waiting passenger.
    if (target) {
      const tx = this.#mapX(target.x)
      const ty = this.#mapY(target.z)
      const hex = `#${target.color.toString(16).padStart(6, '0')}`

      // A soft halo so the marker survives against road and grass alike.
      ctx.beginPath()
      ctx.arc(tx, ty, 7, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fill()

      ctx.beginPath()
      ctx.arc(tx, ty, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = hex
      ctx.fill()
    }

    // The car: a triangle, so it shows facing as well as position.
    const cx = this.#mapX(car.x)
    const cy = this.#mapY(car.z)

    ctx.save()
    ctx.translate(cx, cy)
    // World heading 0 faces +X, which is +x on the map; canvas Y already runs
    // the same way as world Z, so the angle maps across directly.
    ctx.rotate(car.heading)

    ctx.beginPath()
    ctx.moveTo(7, 0)
    ctx.lineTo(-4.5, 4.5)
    ctx.lineTo(-2, 0)
    ctx.lineTo(-4.5, -4.5)
    ctx.closePath()
    ctx.fillStyle = '#ffc93c'
    ctx.fill()
    ctx.lineWidth = 1.6
    ctx.strokeStyle = '#23405e'
    ctx.stroke()

    ctx.restore()
  }

  dispose(): void {
    this.element.remove()
  }

  #mapX(worldX: number): number {
    return this.#offsetX + (worldX - this.#bounds.minX) * this.#scale
  }

  #mapY(worldZ: number): number {
    return this.#offsetY + (worldZ - this.#bounds.minZ) * this.#scale
  }

  /** Pre-render the road grid once; it never changes. */
  #renderBase(roads: RoadNetwork, worldScale: number): HTMLCanvasElement {
    const base = document.createElement('canvas')
    base.width = this.#size * this.#dpr
    base.height = this.#size * this.#dpr

    const ctx = base.getContext('2d')
    if (!ctx) return base
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)

    // Ground.
    ctx.fillStyle = '#6aa85a'
    ctx.fillRect(0, 0, this.#size, this.#size)

    // Roads, drawn as one path so the joins at intersections merge cleanly.
    ctx.strokeStyle = '#4e535f'
    ctx.lineWidth = Math.max(2.5, roads.roadWidth * worldScale * this.#scale)
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const s of roads.segments) {
      ctx.moveTo(this.#mapX(s.ax * worldScale), this.#mapY(s.ay * worldScale))
      ctx.lineTo(this.#mapX(s.bx * worldScale), this.#mapY(s.by * worldScale))
    }
    ctx.stroke()

    return base
  }
}
