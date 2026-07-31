/**
 * Draws the town.
 *
 * Split from generation so the world model stays testable headlessly. The
 * renderer is stateless apart from the city reference; everything animates
 * off the time value passed in.
 *
 * Draw order is a deliberate sandwich: ground and buildings render below the
 * gameplay layer (car, passengers), then tree foliage renders above it, so
 * driving past a park reads as slipping beneath the canopy — cheap depth in
 * a flat top-down world.
 */

import type { Camera } from '../../engine/render/camera.js'
import { toCss, withAlpha } from '../../engine/render/color.js'
import { circle, roundRect } from '../../engine/render/shapes.js'
import { PALETTE } from '../config/palette.js'
import type { City } from './city.js'

export class CityRenderer {
  readonly #city: City

  constructor(city: City) {
    this.#city = city
  }

  /** Everything beneath the gameplay layer. */
  renderGround(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const view = camera.getVisibleBounds(40, VIEW_SCRATCH)

    // Grass base. One big fill — cheaper than worrying about what's visible.
    ctx.fillStyle = toCss(PALETTE.grass)
    ctx.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY)

    // Parks: a lighter patch with soft corners.
    ctx.fillStyle = toCss(PALETTE.grassPark)
    for (const p of this.#city.parks) {
      if (p.x > view.maxX || p.y > view.maxY || p.x + p.w < view.minX || p.y + p.h < view.minY) {
        continue
      }
      roundRect(ctx, p.x, p.y, p.w, p.h, 26)
      ctx.fill()
    }

    this.#renderRoads(ctx, view)
    this.#renderBuildings(ctx, view)
  }

  /** Tree canopy — call after the gameplay layer so foliage overlaps the car. */
  renderCanopy(ctx: CanvasRenderingContext2D, camera: Camera, time: number): void {
    const view = camera.getVisibleBounds(40, VIEW_SCRATCH)

    for (const t of this.#city.trees) {
      if (t.x < view.minX - 30 || t.x > view.maxX + 30 || t.y < view.minY - 30 || t.y > view.maxY + 30) {
        continue
      }

      // Gentle sway: the canopy drifts, the trunk stays put.
      const sway = Math.sin(time * 0.9 + t.phase) * 1.6

      ctx.fillStyle = toCss(PALETTE.shadow)
      ctx.beginPath()
      ctx.ellipse(t.x + 4, t.y + 5, t.r * 0.95, t.r * 0.6, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = toCss(PALETTE.treeTrunk)
      circle(ctx, t.x, t.y, 3.5)
      ctx.fill()

      ctx.fillStyle = toCss(t.foliage)
      circle(ctx, t.x + sway, t.y - 2, t.r)
      ctx.fill()

      // A lighter offset blob gives the canopy volume for one extra fill.
      ctx.fillStyle = toCss(withAlpha(PALETTE.treeFoliageLight, 0.55))
      circle(ctx, t.x + sway - t.r * 0.28, t.y - 2 - t.r * 0.3, t.r * 0.55)
      ctx.fill()
    }
  }

  #renderRoads(
    ctx: CanvasRenderingContext2D,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const { roads } = this.#city

    // Three passes over the same segments: sidewalk band, asphalt, dashes.
    // Drawing all sidewalks before any asphalt is what makes intersections
    // join seamlessly — interleaving would leave seams at every corner.
    ctx.lineCap = 'round'

    ctx.strokeStyle = toCss(PALETTE.sidewalk)
    ctx.lineWidth = roads.pavedWidth
    this.#strokeSegments(ctx, view, roads.pavedWidth)

    ctx.strokeStyle = toCss(PALETTE.road)
    ctx.lineWidth = roads.roadWidth
    this.#strokeSegments(ctx, view, roads.roadWidth)

    ctx.strokeStyle = toCss(PALETTE.roadDash)
    ctx.lineWidth = 4
    ctx.setLineDash([18, 22])
    this.#strokeSegments(ctx, view, roads.roadWidth)
    ctx.setLineDash([])
  }

  #strokeSegments(
    ctx: CanvasRenderingContext2D,
    view: { minX: number; minY: number; maxX: number; maxY: number },
    width: number,
  ): void {
    const pad = width / 2
    ctx.beginPath()
    for (const s of this.#city.roads.segments) {
      // Segment AABB vs view test (segments are axis-aligned).
      const minX = Math.min(s.ax, s.bx) - pad
      const maxX = Math.max(s.ax, s.bx) + pad
      const minY = Math.min(s.ay, s.by) - pad
      const maxY = Math.max(s.ay, s.by) + pad
      if (minX > view.maxX || maxX < view.minX || minY > view.maxY || maxY < view.minY) continue

      ctx.moveTo(s.ax, s.ay)
      ctx.lineTo(s.bx, s.by)
    }
    ctx.stroke()
  }

  #renderBuildings(
    ctx: CanvasRenderingContext2D,
    view: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    for (const b of this.#city.buildings) {
      if (b.x > view.maxX || b.y > view.maxY || b.x + b.w < view.minX || b.y + b.h < view.minY) {
        continue
      }

      // Drop shadow, offset toward the light's opposite corner.
      ctx.fillStyle = toCss(PALETTE.shadow)
      roundRect(ctx, b.x + 5, b.y + 6, b.w, b.h, 8)
      ctx.fill()

      // Wall colour peeks out around the roof as a trim band.
      ctx.fillStyle = toCss(b.trimColor)
      roundRect(ctx, b.x, b.y, b.w, b.h, 8)
      ctx.fill()

      // Roof, inset.
      ctx.fillStyle = toCss(b.roofColor)
      roundRect(ctx, b.x + 5, b.y + 5, b.w - 10, b.h - 10, 6)
      ctx.fill()

      // One small deterministic roof detail so buildings aren't clones.
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      if (b.detail < 0.33) {
        // Rooftop AC box.
        ctx.fillStyle = toCss(PALETTE.sidewalk)
        roundRect(ctx, cx - 7, cy - 7, 14, 14, 3)
        ctx.fill()
      } else if (b.detail < 0.66) {
        // Skylight.
        ctx.fillStyle = toCss(withAlpha(PALETTE.glass, 0.85))
        roundRect(ctx, cx - 9, cy - 6, 18, 12, 4)
        ctx.fill()
      } else {
        // Roof ridge line.
        ctx.strokeStyle = toCss(withAlpha(PALETTE.shadow, 0.5))
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(b.x + 12, cy)
        ctx.lineTo(b.x + b.w - 12, cy)
        ctx.stroke()
      }
    }
  }
}

/** Reused per frame; renderers never keep it across calls. */
const VIEW_SCRATCH = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
