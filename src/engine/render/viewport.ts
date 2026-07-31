/**
 * Owns the canvas, its backing-store resolution, and the device-pixel-ratio
 * dance.
 *
 * Getting DPR wrong is the single most common reason a Canvas2D game looks
 * blurry on a tablet, so this is centralised: the canvas element is sized in
 * CSS pixels, the backing store is sized in device pixels, and the 2D context
 * is pre-scaled so all drawing code can work in CSS pixels and forget the
 * ratio exists.
 *
 * On weak devices we also cap the effective DPR — a 3x Retina backing store is
 * 9x the fill rate of a 1x one, which is the difference between 60fps and
 * 25fps for a full-screen game.
 */

export interface ViewportOptions {
  /**
   * Upper bound on device pixel ratio. 2 keeps text and vector edges crisp
   * while avoiding the fill-rate cliff of 3x phone screens.
   */
  maxDpr?: number
  /** Called after every resize, with the new CSS-pixel size. */
  onResize?: (width: number, height: number, dpr: number) => void
  /**
   * `alpha: false` lets the browser skip per-pixel compositing of the canvas
   * against the page. We always paint an opaque sky, so this is a free win.
   */
  alpha?: boolean
}

export class Viewport {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D

  /** Width in CSS pixels — the coordinate space all drawing code uses. */
  #width = 0
  /** Height in CSS pixels. */
  #height = 0
  /** The DPR actually in use, after clamping. */
  #dpr = 1

  #maxDpr: number
  readonly #onResize: ((w: number, h: number, dpr: number) => void) | undefined
  #resizeObserver: ResizeObserver | null = null
  #mediaQuery: MediaQueryList | null = null
  #disposed = false

  constructor(canvas: HTMLCanvasElement, options: ViewportOptions = {}) {
    this.canvas = canvas
    this.#maxDpr = options.maxDpr ?? 2
    this.#onResize = options.onResize

    const ctx = canvas.getContext('2d', {
      alpha: options.alpha ?? false,
      // We repaint every pixel each frame, so the browser never needs to read
      // back the previous frame's contents.
      desynchronized: true,
    })
    if (!ctx) {
      throw new Error('Viewport: could not acquire a 2D canvas context')
    }
    this.ctx = ctx

    this.#observe()
    this.resize()
  }

  get width(): number {
    return this.#width
  }

  get height(): number {
    return this.#height
  }

  get dpr(): number {
    return this.#dpr
  }

  /** Shortest screen dimension — the basis for scale-independent UI sizing. */
  get minSide(): number {
    return Math.min(this.#width, this.#height)
  }

  get aspect(): number {
    return this.#height === 0 ? 1 : this.#width / this.#height
  }

  get isPortrait(): boolean {
    return this.#height > this.#width
  }

  /**
   * Lower the DPR cap at runtime. The quality-tier system calls this when it
   * detects sustained frame drops.
   */
  setMaxDpr(maxDpr: number): void {
    if (maxDpr === this.#maxDpr) return
    this.#maxDpr = maxDpr
    this.resize()
  }

  /**
   * Re-measure and resize the backing store. Safe to call every frame — it
   * early-outs when nothing changed, because assigning to `canvas.width`
   * clears the canvas and resets all context state.
   */
  resize(): boolean {
    const rect = this.canvas.getBoundingClientRect()

    // getBoundingClientRect can report 0 during startup or while the element
    // is display:none. Fall back to the window so we never divide by zero.
    const cssWidth = Math.max(1, Math.round(rect.width || window.innerWidth))
    const cssHeight = Math.max(1, Math.round(rect.height || window.innerHeight))
    const dpr = Math.min(window.devicePixelRatio || 1, this.#maxDpr)

    const backingWidth = Math.round(cssWidth * dpr)
    const backingHeight = Math.round(cssHeight * dpr)

    if (
      this.canvas.width === backingWidth &&
      this.canvas.height === backingHeight &&
      this.#width === cssWidth &&
      this.#height === cssHeight
    ) {
      return false
    }

    this.canvas.width = backingWidth
    this.canvas.height = backingHeight
    this.#width = cssWidth
    this.#height = cssHeight
    this.#dpr = dpr

    this.#onResize?.(cssWidth, cssHeight, dpr)
    return true
  }

  /**
   * Reset the context to a known state and apply the DPR transform. Call once
   * at the top of every frame, before any drawing.
   */
  beginFrame(): CanvasRenderingContext2D {
    const ctx = this.ctx
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'low'
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    return ctx
  }

  /** Convert a pointer/mouse event's client coordinates into CSS-pixel canvas space. */
  clientToCanvas(clientX: number, clientY: number, out = { x: 0, y: 0 }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    // Scale by rect vs CSS size in case the canvas is transformed by CSS.
    const scaleX = rect.width === 0 ? 1 : this.#width / rect.width
    const scaleY = rect.height === 0 ? 1 : this.#height / rect.height
    out.x = (clientX - rect.left) * scaleX
    out.y = (clientY - rect.top) * scaleY
    return out
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#mediaQuery?.removeEventListener('change', this.#onDprChange)
    this.#mediaQuery = null
    window.removeEventListener('resize', this.#onWindowResize)
    window.removeEventListener('orientationchange', this.#onWindowResize)
  }

  #observe(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.resize())
      this.#resizeObserver.observe(this.canvas)
    }

    // ResizeObserver doesn't fire when only the DPR changes (dragging the
    // window between a laptop screen and an external monitor), so watch for
    // that separately.
    window.addEventListener('resize', this.#onWindowResize)
    window.addEventListener('orientationchange', this.#onWindowResize)
    this.#watchDpr()
  }

  readonly #onWindowResize = (): void => {
    this.resize()
  }

  readonly #onDprChange = (): void => {
    this.resize()
    this.#watchDpr()
  }

  /**
   * `resolution` media queries only match one exact value, so the listener has
   * to be re-registered against the new DPR each time it changes.
   */
  #watchDpr(): void {
    if (this.#disposed || typeof window.matchMedia !== 'function') return
    this.#mediaQuery?.removeEventListener('change', this.#onDprChange)
    const dpr = window.devicePixelRatio || 1
    this.#mediaQuery = window.matchMedia(`(resolution: ${dpr}dppx)`)
    this.#mediaQuery.addEventListener('change', this.#onDprChange)
  }
}
