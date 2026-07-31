/**
 * Canvas2D path primitives.
 *
 * The whole game is drawn from these. Keeping them in one module means the
 * shape language stays consistent — everything is built from soft, rounded,
 * chunky forms, which is what makes the art read as friendly rather than
 * technical.
 *
 * These functions build paths and (optionally) fill/stroke them. They never
 * touch transform state; callers own `save`/`restore`.
 */

const TAU = Math.PI * 2

/**
 * A rounded rectangle. Radii are clamped to half the smaller side so an
 * over-large radius degrades to a capsule instead of producing a self-
 * intersecting path.
 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | { tl?: number; tr?: number; br?: number; bl?: number },
): void {
  const max = Math.min(Math.abs(w), Math.abs(h)) / 2

  let tl: number
  let tr: number
  let br: number
  let bl: number

  if (typeof radius === 'number') {
    tl = tr = br = bl = Math.min(radius, max)
  } else {
    tl = Math.min(radius.tl ?? 0, max)
    tr = Math.min(radius.tr ?? 0, max)
    br = Math.min(radius.br ?? 0, max)
    bl = Math.min(radius.bl ?? 0, max)
  }

  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr)
  ctx.lineTo(x + w, y + h - br)
  if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br)
  ctx.lineTo(x + bl, y + h)
  if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl)
  ctx.lineTo(x, y + tl)
  if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl)
  ctx.closePath()
}

/** Rounded rect centred on (cx, cy) — the common case for vehicles and icons. */
export function roundRectCentered(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  radius: number | { tl?: number; tr?: number; br?: number; bl?: number },
): void {
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, radius)
}

export function circle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(0, r), 0, TAU)
}

export function ellipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation = 0,
): void {
  ctx.beginPath()
  ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), rotation, 0, TAU)
}

/** A stadium/pill shape: a rectangle with fully rounded ends. */
export function capsule(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  roundRectCentered(ctx, cx, cy, w, h, Math.min(w, h) / 2)
}

/** A regular polygon, first vertex pointing up. */
export function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = 0,
): void {
  ctx.beginPath()
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU - Math.PI / 2 + rotation
    const px = cx + Math.cos(a) * radius
    const py = cy + Math.sin(a) * radius
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

export function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius = outerRadius * 0.45,
  points = 5,
  rotation = 0,
): void {
  ctx.beginPath()
  const total = points * 2
  for (let i = 0; i < total; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius
    const a = (i / total) * TAU - Math.PI / 2 + rotation
    const px = cx + Math.cos(a) * r
    const py = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/** A rounded five-point star — friendlier than sharp points. */
export function softStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius = outerRadius * 0.5,
  points = 5,
  rotation = 0,
): void {
  const total = points * 2
  ctx.beginPath()

  for (let i = 0; i <= total; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius
    const a = (i / total) * TAU - Math.PI / 2 + rotation
    const px = cx + Math.cos(a) * r
    const py = cy + Math.sin(a) * r

    if (i === 0) {
      ctx.moveTo(px, py)
      continue
    }

    // Quadratic through the midpoint rounds every corner uniformly.
    const prevR = (i - 1) % 2 === 0 ? outerRadius : innerRadius
    const prevA = ((i - 1) / total) * TAU - Math.PI / 2 + rotation
    const prevX = cx + Math.cos(prevA) * prevR
    const prevY = cy + Math.sin(prevA) * prevR
    const midX = (prevX + px) / 2
    const midY = (prevY + py) / 2
    ctx.quadraticCurveTo(prevX, prevY, midX, midY)
  }

  ctx.closePath()
}

/** A heart, for "happy passenger" emotes. */
export function heart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const s = size
  ctx.beginPath()
  ctx.moveTo(cx, cy + s * 0.75)
  ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.35, cx - s * 0.5, cy - s * 1.1, cx, cy - s * 0.35)
  ctx.bezierCurveTo(cx + s * 0.5, cy - s * 1.1, cx + s * 1.4, cy - s * 0.35, cx, cy + s * 0.75)
  ctx.closePath()
}

/** A rounded speech/thought bubble with a tail pointing down-left. */
export function speechBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  radius = Math.min(w, h) * 0.35,
  tailSize = Math.min(w, h) * 0.28,
): void {
  const x = cx - w / 2
  const y = cy - h / 2
  const r = Math.min(radius, Math.min(w, h) / 2)

  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)

  // Tail, sitting just left of centre along the bottom edge.
  const tailRight = cx + tailSize * 0.4
  const tailLeft = cx - tailSize * 0.4
  ctx.lineTo(tailRight, y + h)
  ctx.lineTo(cx - tailSize * 0.1, y + h + tailSize)
  ctx.lineTo(tailLeft, y + h)

  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * A soft drop shadow drawn as a flattened ellipse.
 *
 * Canvas2D's `shadowBlur` is genuinely expensive — it forces a separate blur
 * pass per draw and is one of the fastest ways to lose 60fps on a tablet. A
 * translucent ellipse costs a single fill and, for a top-down cartoon look,
 * is indistinguishable.
 */
export function groundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  rotation = 0,
): void {
  ctx.fillStyle = color
  ellipse(ctx, cx, cy, rx, ry, rotation)
  ctx.fill()
}

/** A rounded polyline — the basis for roads and paths. */
export function polyline(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  close = false,
): void {
  if (points.length === 0) return
  ctx.beginPath()
  ctx.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y)
  }
  if (close) ctx.closePath()
}

/**
 * A smooth curve through a set of points, using quadratic segments between
 * midpoints. Cheaper than Catmull-Rom and visually equivalent at game scale.
 */
export function smoothPath(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
  close = false,
): void {
  if (points.length < 2) {
    polyline(ctx, points, close)
    return
  }

  ctx.beginPath()

  if (close) {
    const first = points[0]!
    const last = points[points.length - 1]!
    ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2)
  } else {
    ctx.moveTo(points[0]!.x, points[0]!.y)
  }

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i]!
    const next = points[i + 1]!
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2)
  }

  const last = points[points.length - 1]!
  if (close) {
    const first = points[0]!
    ctx.quadraticCurveTo(last.x, last.y, (last.x + first.x) / 2, (last.y + first.y) / 2)
    ctx.closePath()
  } else {
    ctx.lineTo(last.x, last.y)
  }
}

/** An arc segment as a filled wedge — pie slices for progress rings. */
export function wedge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): void {
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, Math.max(0, radius), startAngle, endAngle)
  ctx.closePath()
}

/** A ring segment — the shape behind circular progress meters. */
export function ringSegment(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): void {
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(0, outerRadius), startAngle, endAngle)
  ctx.arc(cx, cy, Math.max(0, innerRadius), endAngle, startAngle, true)
  ctx.closePath()
}

/**
 * A teardrop map pin, point at (x, y). Used for the destination marker.
 */
export function mapPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const r = width / 2
  const cy = y - height + r

  ctx.beginPath()
  // Where the circle's tangent meets the point, so the join is smooth.
  const spread = Math.asin(Math.min(1, r / Math.max(r, height - r)))
  ctx.arc(x, cy, r, Math.PI / 2 + spread, Math.PI / 2 - spread, false)
  ctx.lineTo(x, y)
  ctx.closePath()
}

/**
 * A chunky directional arrow (a "go this way" chevron), pointing along +x.
 * Centred on the origin so callers can rotate freely.
 */
export function arrow(
  ctx: CanvasRenderingContext2D,
  length: number,
  thickness: number,
  headScale = 2,
): void {
  const half = thickness / 2
  const headWidth = thickness * headScale
  const headLength = Math.min(length * 0.5, headWidth)
  const shaftEnd = length / 2 - headLength

  ctx.beginPath()
  ctx.moveTo(-length / 2, -half)
  ctx.lineTo(shaftEnd, -half)
  ctx.lineTo(shaftEnd, -headWidth / 2)
  ctx.lineTo(length / 2, 0)
  ctx.lineTo(shaftEnd, headWidth / 2)
  ctx.lineTo(shaftEnd, half)
  ctx.lineTo(-length / 2, half)
  ctx.closePath()
}

/** A plus/cross, for the upgrade "add" affordance. */
export function plus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  thickness: number,
): void {
  const h = size / 2
  const t = thickness / 2
  ctx.beginPath()
  ctx.moveTo(cx - t, cy - h)
  ctx.lineTo(cx + t, cy - h)
  ctx.lineTo(cx + t, cy - t)
  ctx.lineTo(cx + h, cy - t)
  ctx.lineTo(cx + h, cy + t)
  ctx.lineTo(cx + t, cy + t)
  ctx.lineTo(cx + t, cy + h)
  ctx.lineTo(cx - t, cy + h)
  ctx.lineTo(cx - t, cy + t)
  ctx.lineTo(cx - h, cy + t)
  ctx.lineTo(cx - h, cy - t)
  ctx.lineTo(cx - t, cy - t)
  ctx.closePath()
}

/** A checkmark stroke path. Stroke it with a round cap and thick line. */
export function checkmark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.45, cy + size * 0.02)
  ctx.lineTo(cx - size * 0.12, cy + size * 0.35)
  ctx.lineTo(cx + size * 0.45, cy - size * 0.35)
}
