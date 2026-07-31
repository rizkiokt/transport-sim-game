/**
 * A development HUD showing frame timing and engine state.
 *
 * Kept in the engine rather than the game because it reads only engine
 * primitives. It draws in screen space, after everything else, and is
 * tree-shaken out of production builds by the `import.meta.env.DEV` guard at
 * its call site.
 *
 * The frame-time graph matters more than the fps number: a steady 60 with an
 * occasional 40ms spike feels far worse to play than a steady 50, and only a
 * graph makes that visible.
 */

import type { Game } from '../core/game.js'

const WIDTH = 210
const GRAPH_HEIGHT = 46
const PADDING = 10
const LINE_HEIGHT = 15
/** Samples in the rolling frame-time history. */
const HISTORY = 120

/** Milliseconds represented by the full graph height. */
const GRAPH_MAX_MS = 33.4

export class DebugOverlay {
  visible = false

  readonly #game: Game
  readonly #frameTimes = new Float32Array(HISTORY)
  #writeIndex = 0

  /** Extra lines supplied by game code, e.g. player speed or ride state. */
  readonly #customLines: Array<() => string> = []

  constructor(game: Game) {
    this.#game = game
  }

  toggle(): boolean {
    this.visible = !this.visible
    return this.visible
  }

  /** Register a line to display. Return an empty string to skip a frame. */
  addLine(producer: () => string): void {
    this.#customLines.push(producer)
  }

  /** Record this frame's total time. Call every frame, even when hidden. */
  sample(frameDt: number): void {
    this.#frameTimes[this.#writeIndex] = frameDt * 1000
    this.#writeIndex = (this.#writeIndex + 1) % HISTORY
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return

    const { stats } = this.#game
    const lines = [
      `${stats.fps.toFixed(0)} fps`,
      `upd ${stats.updateMs.toFixed(2)}ms  ren ${stats.renderMs.toFixed(2)}ms`,
      `steps ${stats.stepsLastFrame}  dropped ${stats.droppedFrames}`,
      `particles ${this.#game.particles.liveCount}/${this.#game.particles.capacity}`,
      `tweens ${this.#game.tweens.activeCount}`,
      `scene ${this.#game.scenes.stackNames.join(' > ') || '-'}`,
      `tier ${this.#game.settings.tier}  dpr ${this.#game.viewport.dpr.toFixed(2)}`,
      `cam ${this.#game.camera.position.x.toFixed(0)},${this.#game.camera.position.y.toFixed(0)} z${this.#game.camera.effectiveZoom.toFixed(2)}`,
      `t ${this.#game.elapsed.toFixed(1)}s  input ${this.#game.input.lastDevice}`,
    ]

    for (const producer of this.#customLines) {
      const line = producer()
      if (line) lines.push(line)
    }

    const height = PADDING * 2 + GRAPH_HEIGHT + 6 + lines.length * LINE_HEIGHT

    ctx.save()
    // Draw in raw screen space, independent of any camera transform.
    ctx.setTransform(
      this.#game.viewport.dpr,
      0,
      0,
      this.#game.viewport.dpr,
      0,
      0,
    )

    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(8, 12, 24, 0.82)'
    ctx.fillRect(PADDING, PADDING, WIDTH, height)

    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 1
    ctx.strokeRect(PADDING + 0.5, PADDING + 0.5, WIDTH - 1, height - 1)

    this.#renderGraph(ctx, PADDING * 2, PADDING * 2, WIDTH - PADDING * 2, GRAPH_HEIGHT)

    ctx.font = '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#d8e2ff'

    let y = PADDING * 2 + GRAPH_HEIGHT + 6
    for (const line of lines) {
      ctx.fillText(line, PADDING * 2, y)
      y += LINE_HEIGHT
    }

    ctx.restore()
  }

  #renderGraph(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(x, y, w, h)

    // Reference lines at 60fps (16.7ms) and 30fps (33.3ms).
    for (const [ms, color] of [
      [1000 / 60, 'rgba(120, 255, 170, 0.35)'],
      [1000 / 30, 'rgba(255, 190, 120, 0.35)'],
    ] as const) {
      const ly = y + h - (ms / GRAPH_MAX_MS) * h
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, ly + 0.5)
      ctx.lineTo(x + w, ly + 0.5)
      ctx.stroke()
    }

    const barWidth = w / HISTORY
    for (let i = 0; i < HISTORY; i++) {
      // Read oldest-first so the graph scrolls left as time passes.
      const value = this.#frameTimes[(this.#writeIndex + i) % HISTORY]!
      if (value <= 0) continue

      const clamped = Math.min(value, GRAPH_MAX_MS)
      const barHeight = (clamped / GRAPH_MAX_MS) * h

      ctx.fillStyle =
        value > 1000 / 30
          ? '#ff6b6b'
          : value > 1000 / 55
            ? '#ffd166'
            : '#5ad6a0'
      ctx.fillRect(x + i * barWidth, y + h - barHeight, Math.max(1, barWidth - 0.5), barHeight)
    }
  }
}
