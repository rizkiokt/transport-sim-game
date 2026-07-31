/**
 * The main game loop: a fixed-timestep simulation with interpolated rendering.
 *
 * Why fixed timestep: vehicle steering, spring cameras, and the economy all
 * behave differently at 30fps vs 144fps if they integrate raw frame deltas.
 * Pinning the simulation to a constant step makes behaviour identical on a
 * cheap tablet and a gaming monitor, and makes headless balance simulation
 * possible.
 *
 * Rendering then runs once per animation frame with an `alpha` in [0, 1)
 * describing how far we are between the last two simulation states, so
 * motion still looks smooth on high-refresh displays.
 */

export interface LoopCallbacks {
  /**
   * Advance the simulation by exactly `fixedDt` seconds. Called zero or more
   * times per frame.
   */
  update(fixedDt: number): void
  /**
   * Draw a frame.
   *
   * @param alpha how far between the previous and current simulation state
   *   this frame sits, in [0, 1). Interpolate visual positions with it.
   * @param frameDt real elapsed seconds since the last render — use only for
   *   purely cosmetic, non-simulated motion (UI tweens, idle wobbles).
   */
  render(alpha: number, frameDt: number): void
}

export interface LoopOptions {
  /** Simulation rate in Hz. 60 is the sweet spot for this game. */
  updateHz?: number
  /**
   * Ceiling on simulation steps per frame. When the tab is backgrounded or
   * the device stalls, the accumulated time can be enormous; without a cap
   * the loop tries to catch up, takes even longer, and accumulates more time
   * — the "spiral of death". Dropping the excess is the right trade: the
   * simulation briefly runs slow rather than freezing the page.
   */
  maxStepsPerFrame?: number
  /**
   * Largest real frame delta the loop will accept, in seconds. Anything
   * bigger is clamped, which prevents a single long stall from injecting a
   * huge burst of catch-up steps.
   */
  maxFrameDt?: number
}

export interface LoopStats {
  /** Smoothed frames per second. */
  fps: number
  /** Smoothed milliseconds spent inside `update` per frame. */
  updateMs: number
  /** Smoothed milliseconds spent inside `render` per frame. */
  renderMs: number
  /** Simulation steps run during the last frame. */
  stepsLastFrame: number
  /** Total simulation steps since start — a deterministic clock for tests. */
  totalSteps: number
  /** Frames where the step cap was hit and time was discarded. */
  droppedFrames: number
}

export class GameLoop {
  readonly fixedDt: number

  readonly #callbacks: LoopCallbacks
  readonly #maxStepsPerFrame: number
  readonly #maxFrameDt: number

  #running = false
  #rafId = 0
  #lastTime = 0
  #accumulator = 0

  readonly #stats: LoopStats = {
    fps: 0,
    updateMs: 0,
    renderMs: 0,
    stepsLastFrame: 0,
    totalSteps: 0,
    droppedFrames: 0,
  }

  /** Set while the tab is hidden or the loop is explicitly paused. */
  #paused = false
  #visibilityHandler: (() => void) | null = null

  constructor(callbacks: LoopCallbacks, options: LoopOptions = {}) {
    const updateHz = options.updateHz ?? 60
    this.fixedDt = 1 / updateHz
    this.#callbacks = callbacks
    this.#maxStepsPerFrame = options.maxStepsPerFrame ?? 5
    this.#maxFrameDt = options.maxFrameDt ?? 0.25
  }

  get running(): boolean {
    return this.#running
  }

  get paused(): boolean {
    return this.#paused
  }

  get stats(): Readonly<LoopStats> {
    return this.#stats
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#lastTime = performance.now()
    this.#accumulator = 0
    this.#installVisibilityHandler()
    this.#rafId = requestAnimationFrame(this.#frame)
  }

  stop(): void {
    if (!this.#running) return
    this.#running = false
    cancelAnimationFrame(this.#rafId)
    this.#removeVisibilityHandler()
  }

  /**
   * Pause the simulation while continuing to render. Used for the shop and
   * pause overlays, where the world should freeze but the UI must still
   * animate.
   */
  pause(): void {
    this.#paused = true
  }

  resume(): void {
    if (!this.#paused) return
    this.#paused = false
    // Discard the time that passed while paused so the world doesn't
    // fast-forward on resume.
    this.#lastTime = performance.now()
    this.#accumulator = 0
  }

  /**
   * Run a single simulation step immediately, ignoring the accumulator.
   * Exists for tests, headless balance runs, and frame-stepping in the debug
   * overlay.
   */
  stepOnce(): void {
    this.#callbacks.update(this.fixedDt)
    this.#stats.totalSteps++
  }

  readonly #frame = (now: number): void => {
    if (!this.#running) return
    this.#rafId = requestAnimationFrame(this.#frame)

    let frameDt = (now - this.#lastTime) / 1000
    this.#lastTime = now

    // A negative or absurd delta means the clock jumped (tab restore, system
    // sleep). Treat it as a single nominal frame.
    if (!Number.isFinite(frameDt) || frameDt < 0) frameDt = this.fixedDt
    if (frameDt > this.#maxFrameDt) frameDt = this.#maxFrameDt

    let steps = 0
    if (!this.#paused) {
      this.#accumulator += frameDt

      const updateStart = performance.now()
      while (this.#accumulator >= this.fixedDt && steps < this.#maxStepsPerFrame) {
        this.#callbacks.update(this.fixedDt)
        this.#accumulator -= this.fixedDt
        steps++
        this.#stats.totalSteps++
      }
      this.#sample('updateMs', performance.now() - updateStart)

      if (this.#accumulator >= this.fixedDt) {
        // Hit the cap with time still owed. Discard it rather than spiral.
        this.#accumulator = 0
        this.#stats.droppedFrames++
      }
    }
    this.#stats.stepsLastFrame = steps

    const alpha = this.#paused ? 1 : this.#accumulator / this.fixedDt
    const renderStart = performance.now()
    this.#callbacks.render(alpha, frameDt)
    this.#sample('renderMs', performance.now() - renderStart)

    this.#sample('fps', frameDt > 0 ? 1 / frameDt : 0)
  }

  /** Exponential moving average, so the debug HUD doesn't flicker. */
  #sample(key: 'fps' | 'updateMs' | 'renderMs', value: number): void {
    const smoothing = 0.9
    this.#stats[key] = this.#stats[key] * smoothing + value * (1 - smoothing)
  }

  #installVisibilityHandler(): void {
    if (typeof document === 'undefined' || this.#visibilityHandler) return
    this.#visibilityHandler = () => {
      if (document.hidden) {
        // Don't accumulate time while hidden — rAF is throttled to a crawl and
        // the accumulated backlog would otherwise fast-forward the world.
        this.#accumulator = 0
      } else {
        this.#lastTime = performance.now()
        this.#accumulator = 0
      }
    }
    document.addEventListener('visibilitychange', this.#visibilityHandler)
  }

  #removeVisibilityHandler(): void {
    if (typeof document === 'undefined' || !this.#visibilityHandler) return
    document.removeEventListener('visibilitychange', this.#visibilityHandler)
    this.#visibilityHandler = null
  }
}
