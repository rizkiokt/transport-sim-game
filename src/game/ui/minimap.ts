/**
 * The city map.
 *
 * A small top-down canvas in the corner showing the road grid, where the car
 * is, which way it is pointing, and where the current passenger, destination
 * or depot is.
 *
 * This solves a real problem the 3D view created: from a chase camera at
 * street level you cannot see over the buildings, so a destination two blocks
 * away is completely hidden. The compass says *which way*, but only a map
 * says *how the roads get you there* — and a 6-year-old planning a route
 * around a block is doing something genuinely satisfying.
 *
 * **It scrolls with the player rather than showing a fixed town.** The
 * previous version pre-rendered the whole road network once, which an endless
 * city has no equivalent of — there is no "whole town" to fit in the frame.
 * Instead the grid is drawn each frame from the handful of gridlines actually
 * inside the window, which is a dozen strokes and needs no cached image. The
 * car sits at the centre and the world slides underneath it, which is also
 * the more legible design: "where am I" stops being a question.
 *
 * Off-screen markers are clamped to the rim rather than disappearing, so the
 * depot and the current fare always point somewhere.
 */

export interface MinimapMarker {
  x: number
  z: number
  color: number
  /** Drawn as a house-ish square instead of a dot. Used for the depot. */
  square?: boolean
}

export interface MinimapOptions {
  /** Distance between parallel roads, world units. */
  blockSize: number
  /** Asphalt width, world units. */
  roadWidth: number
  /** How many world units across the map window shows. */
  span?: number
  /** On-screen size in CSS pixels. */
  size?: number
}

export class Minimap {
  readonly element: HTMLDivElement

  readonly #canvas: HTMLCanvasElement
  readonly #ctx: CanvasRenderingContext2D

  readonly #size: number
  readonly #dpr: number
  readonly #blockSize: number
  readonly #roadWidth: number
  readonly #span: number
  /** World units -> map pixels. */
  readonly #scale: number

  /** Camera centre, in world units. Follows the car. */
  #centreX = 0
  #centreZ = 0

  constructor(container: HTMLElement, options: MinimapOptions) {
    this.#size = options.size ?? 150
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.#blockSize = options.blockSize
    this.#roadWidth = options.roadWidth
    this.#span = options.span ?? options.blockSize * 5
    this.#scale = this.#size / this.#span

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
  }

  /** Draw the map. Call once per frame. */
  update(
    car: { x: number; z: number; heading: number },
    markers: ReadonlyArray<MinimapMarker | null | undefined> = [],
  ): void {
    this.#centreX = car.x
    this.#centreZ = car.z

    const ctx = this.#ctx
    const size = this.#size
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)

    // Ground.
    ctx.fillStyle = '#6aa85a'
    ctx.fillRect(0, 0, size, size)

    this.#drawGrid()

    for (const marker of markers) {
      if (marker) this.#drawMarker(marker)
    }

    // The car: a triangle, so it shows facing as well as position. Always
    // dead centre, because the map is centred on it.
    ctx.save()
    ctx.translate(size / 2, size / 2)
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

  // -------------------------------------------------------------- internals

  #mapX(worldX: number): number {
    return this.#size / 2 + (worldX - this.#centreX) * this.#scale
  }

  #mapY(worldZ: number): number {
    return this.#size / 2 + (worldZ - this.#centreZ) * this.#scale
  }

  /**
   * Stroke every gridline that falls inside the window.
   *
   * On a regular grid the visible lines are just the integers between the
   * window's edges, so this is a short loop with no world data involved —
   * the same insight that makes the road lookup arithmetic.
   */
  #drawGrid(): void {
    const ctx = this.#ctx
    const b = this.#blockSize
    const half = this.#span / 2

    const minX = Math.floor((this.#centreX - half) / b)
    const maxX = Math.ceil((this.#centreX + half) / b)
    const minZ = Math.floor((this.#centreZ - half) / b)
    const maxZ = Math.ceil((this.#centreZ + half) / b)

    ctx.strokeStyle = '#4e535f'
    ctx.lineWidth = Math.max(2.5, this.#roadWidth * this.#scale)
    ctx.lineCap = 'butt'
    ctx.beginPath()
    for (let i = minX; i <= maxX; i++) {
      const x = this.#mapX(i * b)
      ctx.moveTo(x, 0)
      ctx.lineTo(x, this.#size)
    }
    for (let i = minZ; i <= maxZ; i++) {
      const y = this.#mapY(i * b)
      ctx.moveTo(0, y)
      ctx.lineTo(this.#size, y)
    }
    ctx.stroke()
  }

  /**
   * Draw one marker, clamped to the rim when it is outside the window.
   *
   * Clamping rather than hiding matters: the depot and the current fare are
   * often several blocks away, and a marker that simply vanishes tells a
   * child nothing about which way to drive.
   */
  #drawMarker(marker: MinimapMarker): void {
    const ctx = this.#ctx
    const size = this.#size
    const hex = `#${marker.color.toString(16).padStart(6, '0')}`

    let mx = this.#mapX(marker.x)
    let my = this.#mapY(marker.z)
    const pad = 9
    const offScreen = mx < pad || mx > size - pad || my < pad || my > size - pad
    mx = Math.max(pad, Math.min(size - pad, mx))
    my = Math.max(pad, Math.min(size - pad, my))

    // A soft halo so the marker survives against road and grass alike.
    ctx.beginPath()
    ctx.arc(mx, my, 7, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fill()

    ctx.fillStyle = hex
    if (marker.square) {
      ctx.fillRect(mx - 4, my - 4, 8, 8)
    } else {
      ctx.beginPath()
      ctx.arc(mx, my, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // A tick pointing off the edge, so a pinned marker reads as "that way"
    // rather than "here".
    if (offScreen) {
      const dx = marker.x - this.#centreX
      const dz = marker.z - this.#centreZ
      const len = Math.hypot(dx, dz) || 1
      ctx.beginPath()
      ctx.moveTo(mx + (dx / len) * 8, my + (dz / len) * 8)
      ctx.lineTo(mx - (dz / len) * 4, my + (dx / len) * 4)
      ctx.lineTo(mx + (dz / len) * 4, my - (dx / len) * 4)
      ctx.closePath()
      ctx.fill()
    }
  }
}
