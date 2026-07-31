```ts
// inside ChunkBaker.bake
ctx.lineCap = 'round'; ctx.lineJoin = 'round';

// Pass 1: kerb (a wider stroke underneath) — one pass, all edges.
ctx.strokeStyle = pal.kerb;
for (const e of chunk.edges) { ctx.lineWidth = (e.width + 8) * zoom; strokePoly(ctx, e.poly, ox, oy, zoom); }

// Pass 2: road surface.
ctx.strokeStyle = pal.roadFill;
for (const e of chunk.edges) { ctx.lineWidth = e.width * zoom; strokePoly(ctx, e.poly, ox, oy, zoom); }

// Pass 3: centre dashes, only on 2+ lane edges.
ctx.strokeStyle = pal.roadDash; ctx.lineWidth = 3 * zoom;
ctx.setLineDash([18 * zoom, 14 * zoom]);
for (const e of chunk.edges) { if (e.lanes >= 2) strokePoly(ctx, e.poly, ox, oy, zoom); }
ctx.setLineDash([]);
```

Three state changes total for the entire road network of a chunk, regardless of edge count. Rounded caps and joins produce correct-looking junctions for free — no junction geometry is authored anywhere.

---

## 7. Determinism, testing, and tooling

### 7.1 Seeded RNG with named sub-streams

```ts
// src/engine/math/Rng.ts
export class Rng {
  private a = 0; private b = 0; private c = 0; private d = 0;

  constructor(seed: number | string) { this.reseed(seed); }
  reseed(seed: number | string): void;   // xmur3 string→u32 x4, then 12 warm-up rounds

  /** sfc32. ~2ns/call, passes PractRand to 32GB. */
  next(): number {
    const t = (this.a + this.b | 0) + this.d | 0;
    this.d = this.d + 1 | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = this.c + (this.c << 3) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = this.c + t | 0;
    return (t >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates in place. */
  shuffle<T>(items: T[]): T[];
  chance(p: number): boolean;
  /** Box-Muller, cached second sample. */
  gaussian(mean: number, stdDev: number): number;

  /**
   * Deterministic named sub-stream. THE critical API: adding a new particle
   * effect that calls rng.next() must not change traffic spawn positions.
   * Every subsystem forks its own stream once at init and never shares.
   */
  fork(label: string): Rng;

  getState(): [number, number, number, number];
  setState(s: readonly [number, number, number, number]): void;
}
```

Streams forked at bootstrap and stored on their owners: `rng.fork('traffic')`, `rng.fork('requests')`, `rng.fork('decor')`, `rng.fork('passengerLooks')`, `rng.fork('fx')`. The `fx` stream is explicitly **not** saved and **not** part of the digest — presentation randomness must be free to diverge.

### 7.2 The determinism rules (lint-enforced)

```js
// eslint.config.js (excerpt)
{
  files: ['src/game/systems/**', 'src/game/world/**', 'src/game/progression/**'],
  rules: {
    'no-restricted-properties': ['error',
      { object: 'Math',        property: 'random',  message: 'Use ctx.rng — sim must be deterministic.' },
      { object: 'Date',        property: 'now',     message: 'Use ctx.time.sim.' },
      { object: 'performance', property: 'now',     message: 'Use ctx.time.sim (or ctx.profiler).' },
    ],
    'no-restricted-globals': ['error',
      { name: 'requestAnimationFrame', message: 'Systems never schedule frames.' },
      { name: 'setTimeout',            message: 'Use ctx.simScheduler.after().' },
      { name: 'setInterval',           message: 'Use ctx.simScheduler.every().' },
    ],
  },
}
```

Four additional rules, enforced by review and by the golden test:

1. **No iteration over a `Set` or `Map` keyed by object identity** in `fixedUpdate`. Insertion order is deterministic in JS, but insertion order derived from a `Map<Entity, …>` is only deterministic if entity creation order is. It is (see rule 2), but keying by `EntityId` and iterating dense arrays is clearer, so that is the standard.
2. **Entity ids are monotonically increasing and never reused.** `World.free` is a debug-mode-only pool that is disabled by default; id reuse would make the golden digest depend on destruction timing. At 500 live entities and a few thousand spawns per session, a `number` id never comes close to overflowing.
3. **`fixedUpdate` may not read `ctx.players[n].camera`, `ctx.input.pointers()` in world space, or anything derived from viewport size.** Screen-space input is converted to intents by `PlayerControlSystem` using the *previous* frame's camera snapshot, and the intent is what enters the sim. This is also what makes split-screen and headless runs work.
4. **No floating-point accumulation across `Number.MAX_SAFE_INTEGER` boundaries.** `ctx.time.sim` is `step * fixedDt` computed from the integer step counter, never `+= dt`.

### 7.3 Headless simulation

```ts
// src/dev/headless.ts
export interface HeadlessOpts {
  seed: number;
  /** Simulated minutes. 10 minutes = 36,000 steps ≈ 1.5s of wall clock. */
  minutes: number;
  policy: DriverPolicy;
  district: DistrictId;
  startProfile?: Partial<PlayerProfile>;
  /** Called every N steps for time-series output. */
  sample?: (step: number, snapshot: SimSnapshot) => void;
}

export interface SimReport {
  seed: number;
  steps: number;
  ridesCompleted: number;
  moneyEarned: number;
  moneyPerMinute: number;
  averageRideSeconds: number;
  timeIdleFraction: number;
  vehiclesAffordableAt: Partial<Record<VehicleId, number /* minutes */>>;
  digest: number;
  systemMs: Record<string, number>;    // total time per system, for hot-spotting
}

export function runHeadless(opts: HeadlessOpts): SimReport;
```

Implementation is ~80 lines because the architecture already permits it: build a `GameContext` with `NullRenderer`, an `AudioEngine` whose `context` is `null`, a `FixedClock`, and `SystemRunner.forHeadless(ALL_SYSTEMS)` (which drops every system with `headless: false` — i.e. every `lateUpdate`-only presentation system). Then loop `runner.fixedUpdate(FIXED_DT)` N times. It runs in Node under `tsx`, no DOM, no canvas.

```ts
// src/dev/DriverPolicy.ts
export interface DriverPolicy {
  readonly name: string;
  /** Produce a `move` intent for this step. Deterministic given (state, rng). */
  decide(ctx: GameContext, self: With<'transform' | 'motion' | 'driver'>, rng: Rng): DriveIntent;
}
export const Policies = {
  /** Ceiling: perfect pathing, never off-road. Upper bound on earn rate. */
  optimal: DriverPolicy,
  /** Target: our model of a competent 6-year-old. 60% path efficiency, wanders. */
  child: DriverPolicy,
  /** Floor: mostly random input. If THIS still earns money, nobody gets stuck. */
  flailing: DriverPolicy,
} as const;
```

`npm run sim` sweeps 30 seeds × 3 policies × 4 progression stages and prints a table. The design question it answers is the one that matters most for this audience: **does the `flailing` policy still reach the second vehicle within 20 minutes?** If not, the economy is too punishing and `content/upgrades.ts` gets retuned — without a human replaying the game 90 times.

### 7.4 Test strategy (Vitest 3)

| Layer | What | Where |
|---|---|---|
| **Pure math** | Vec2/Angle ops, `lerpAngle` shortest-arc across ±π, spline arc-length accuracy vs numeric integration (<0.1%), easing monotonicity and endpoints, `Rng` reproducibility + `fork` independence + state round-trip | `tests/math/` |
| **ECS** | Component add/remove updates `mask`, query caches invalidate exactly on structural change, `queryNot` exclusion correctness, `World.digest()` stability | `tests/ecs/` |
| **World** | A* returns the same cost as brute-force Dijkstra on `tinyCity` for all node pairs and all masks; `nearestEdge` recall vs brute-force scan on 500 random points; `SpatialHash.queryCircle` returns a superset of, and no more than 3× the size of, the brute-force result | `tests/world/` |
| **Economy** | Fare is monotonic in distance; upgrade cost is strictly increasing; money can never go negative through any purchase path; `Policies.flailing` earns > 0 over 10 minutes | `tests/economy/` |
| **Save** | Every version fixture V1..Vn migrates to current and passes `validate`; truncated payload falls back to backup; checksum mismatch is detected; export→import round-trips exactly | `tests/save/` |
| **Render (no canvas needed)** | Every registered `ShapeDef` draws without throwing against a `RecordingContext`; op-count budget per shape; **zero uses of `shadowBlur` or `filter` anywhere** | `tests/render/` |
| **Golden run** | Seed 1234 + recorded input tape → `world.digest()` at step 3600 equals the fixture, exactly | `tests/golden/` |

The recording-context trick is worth spelling out, because it gives us real render testing in Node with no `canvas` dependency:

```ts
// tests/helpers/RecordingContext.ts
export interface RecordedOp { op: string; args: readonly unknown[]; }

/**
 * A Proxy that satisfies the CanvasRenderingContext2D surface our shapes use,
 * records every call and property set, and returns plausible values for the
 * few queries shapes make (measureText, createLinearGradient).
 */
export function createRecordingContext(): {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
  countOf(op: string): number;
};
```

```ts
// tests/render/shapes.test.ts
import { ALL_SHAPES } from '@game/art';

describe.each(ALL_SHAPES)('shape $id', (def) => {
  it('draws without throwing at every zoom bucket', () => {
    for (const z of ZOOM_BUCKETS) {
      const { ctx } = createRecordingContext();
      expect(() => def.draw(ctx, defaultParams(def), z)).not.toThrow();
    }
  });

  it('stays within its draw-op budget', () => {
    const { ctx, ops } = createRecordingContext();
    def.draw(ctx, defaultParams(def), 1);
    // Baked once, so this is a *complexity* budget, not a per-frame budget —
    // but it catches "somebody drew 4000 blades of grass in one shape".
    expect(ops.length).toBeLessThan(def.cachePolicy === 'immediate' ? 40 : 400);
  });

  it('never uses banned expensive features', () => {
    const { ctx, ops } = createRecordingContext();
    def.draw(ctx, defaultParams(def), 1);
    expect(ops.find((o) => o.op === 'set:shadowBlur' && o.args[0] !== 0)).toBeUndefined();
    expect(ops.find((o) => o.op === 'set:filter' && o.args[0] !== 'none')).toBeUndefined();
  });
});
```

The golden test, and how to regenerate it without making it meaningless:

```ts
// tests/golden/goldenRun.test.ts
it('is deterministic across runs and builds', () => {
  const tape = InputTape.fromJson(readFixture('tape-1234.json'));
  const a = runHeadless({ seed: 1234, minutes: 1, policy: Policies.tape(tape), district: 'downtown' });
  const b = runHeadless({ seed: 1234, minutes: 1, policy: Policies.tape(tape), district: 'downtown' });
  expect(a.digest).toBe(b.digest);                       // same-process determinism
  expect(a.digest).toBe(GOLDEN.digest);                  // cross-build determinism
  expect(a.moneyEarned).toBe(GOLDEN.moneyEarned);
});
```

`npm run golden:regen` rewrites the fixture. **The rule is that regenerating the golden fixture requires a line in the commit message stating why the sim legitimately changed.** Otherwise the test degrades into a rubber stamp, which is the standard failure mode of golden tests.

`World.digest()` is an FNV-1a over `(id, round(x*64), round(y*64), round(rot*1024))` for every entity with a transform, in dense order. Quantising absorbs the last-bit float noise that differs between V8 versions while still catching any real behavioural change.

### 7.5 Debug overlay and dev console

```ts
// src/engine/diag/Profiler.ts
export class Profiler {
  begin(label: string): void;
  end(label: string): void;
  /** Convenience wrapper; the SystemRunner uses this per system. */
  measure<T>(label: string, fn: () => T): T;
  /** Rolling window stats. */
  get(label: string): { last: number; p50: number; p95: number; max: number } | undefined;
  frameEnd(): void;
  readonly enabled: boolean;      // false in prod unless #dev
}
```

```ts
// src/engine/diag/DebugOverlay.ts
export class DebugOverlay {
  /** Cycles: off → compact (fps + frame graph) → full (per-system + counters). */
  cycleMode(): void;
  collect(ctx: GameContext, list: DrawList): void;
}
```

Full mode shows: fps and a 120-frame frame-time graph with a 16.7 ms line; per-system `p50/p95` ms bars; entity count by archetype; `DrawList.length` and post-sort batch-run count; `ShapeCache` entries/bytes/hit-rate/bakes-this-frame; `ChunkStore` loaded/ready/tileBytes; particle count; audio voice count; `Pathfinder` queries/expansions/cache-hits; camera position and zoom; seed and `__BUILD_ID__`; `AdaptiveQuality` current tier.

```ts
// src/engine/diag/DevConsole.ts
export interface DevCommand {
  readonly name: string;
  readonly help: string;
  readonly args?: readonly ArgSpec[];
  run(ctx: GameContext, args: readonly string[]): string | void;
}
export class DevConsole {
  register(cmd: DevCommand): void;
  exec(line: string): string;
  show(): void; hide(): void;
}
```

Commands in `src/dev/devCommands.ts`: `money <n>`, `give <vehicleId>`, `unlock all`, `tp <x> <y>` / `tp <stopId>`, `spawn <archetype> [n]`, `seed <n>`, `district <id>`, `timescale <n>`, `quality <tier>`, `cache clear|stats`, `save export|import|wipe`, `tape record|stop|replay`, `bake <cx> <cy>`.

**Access gating, which matters specifically for this audience.** Neither tool may be reachable by accident:

- Debug overlay: `F3` (desktop), or a **four-finger simultaneous tap held for 1.5 s** (tablet). A six-year-old will not produce that; a parent following a bug-report instruction will.
- Dev console: only when `location.hash` contains `dev`, and it renders into `#dom-ui` (a real `<input>`, so mobile keyboards work).
- Both are `__DEV_TOOLS__`-gated so they tree-shake out of production entirely — except that `#dev` in the URL re-enables the overlay in prod, because "ask the parent to add `#dev` and screenshot the overlay" is the entire remote-debugging strategy for a static site with no telemetry.

### 7.6 What is explicitly not tested

Being honest about the boundary keeps the suite fast and trustworthy:

- **Visual correctness.** No screenshot diffing. `#gallery` (`src/dev/artGallery.ts`) renders every registered shape at every zoom bucket and every colourway on a labelled grid for human or agent screenshot review. That is the review mechanism.
- **Audio aesthetics.** `OfflineAudioContext` tests assert only duration bounds, peak amplitude ≤ 1.0 (no clipping), and no DC offset. Whether the horn sounds funny is a playtest question.
- **Input device integration.** `PointerSource`/`GamepadSource` are thin adapters tested by hand on real devices; the `ActionMap` resolution logic beneath them is unit-tested with synthetic events.
- **Frame rate.** CI runners cannot measure iPad performance. `SimReport.systemMs` catches algorithmic regressions (a system going O(n²)); actual frame budget is validated on the reference devices with the overlay.

---

## 8. Performance budget

### 8.1 Frame budget at 60 fps on the reference device

Reference hardware: **iPad 8th gen (A12) and a 2019 Celeron Chromebook.** Target scene: 1 player vehicle, 40 ambient vehicles, 25 passengers/stops, 120 static props visible, 200 particles, ~9 visible chunks, full HUD.

| Stage | Budget | Notes |
|---|---:|---|
| Input poll + action resolve | 0.2 ms | Pointer/gamepad snapshot, edge computation |
| `fixedUpdate` × 1 (steady state) | **3.4 ms** | breakdown below |
| — Snapshot | 0.15 ms | 500 transform copies |
| — Player control + Driving + RoadAssist | 0.6 ms | includes ~40 `nearestEdge` queries |
| — AI traffic + PathFollow + Route | 0.9 ms | spline sampling dominates |
| — PathRequest (budgeted A*) | 0.4 ms | hard-capped by expansion budget |
| — SpatialIndex rebuild | 0.15 ms | 500 inserts |
| — Collision (soft) | 0.4 ms | hash-broadphase, ~200 pair tests |
| — Gameplay (pickup/dropoff/economy/progression) | 0.3 ms | mostly early-outs |
| — Chunk streaming + spawn + cleanup + event drain | 0.5 ms | excludes baking (see below) |
| `lateUpdate` | **1.6 ms** | camera 0.05, tweens 0.15, springs/bob 0.2, particles 0.5, audio reaction 0.2, HUD sync 0.2, misc 0.3 |
| DrawList build + cull | 0.7 ms | ~700 commands emitted |
| DrawList radix sort | 0.15 ms | 3 passes over 700 `Uint32` |
| Canvas2D flush | **5.5 ms** | ~700 `drawImage` + 9 chunk tiles + UI |
| UI collect + draw | 0.8 ms | included partly above; HUD is ~40 commands |
| **Subtotal** | **12.4 ms** | |
| Headroom (GC, compositor, Safari overhead) | 4.3 ms | ~26% — deliberately generous |
| **Frame total** | **16.7 ms** | |

Amortised costs deliberately excluded from the steady-state row, each with its own hard cap:
- **Chunk baking**: ≤ 1 tile/frame, aborted at 3 ms. Worst case adds 3 ms for a handful of frames after a fast camera move.
- **Shape baking**: ≤ 6 shapes/frame outside `BootScene`, ~0.1–0.4 ms each.
- **Save flush**: only on payout (debounced 1.5 s) and `pagehide`. ~0.5 ms for a ~4 KB JSON write.

`maxSubSteps = 5` means a genuinely bad frame can spend 5 × 3.4 = 17 ms in simulation alone. That is intentional: the clamps in §4.2 guarantee it cannot compound, and dropping to ~40 fps for two frames during a district transition is invisible.

### 8.2 Canvas2D draw-call and state-change strategy

Ordered by impact:

1. **`drawImage` from cached bitmaps for essentially everything.** Path filling is 5–20× the cost. The only `immediate` shapes permitted are ones that genuinely morph continuously — currently none in the shipping content set. This is enforced socially by the op-budget test and by review.

2. **Never `save()`/`restore()` per entity.** The flush loop uses `setTransform` directly and tracks `globalAlpha` manually:

```ts
// src/engine/render/Canvas2DRenderer.ts (flush core)
private flush(list: DrawList, cam: CameraSnapshot, vp: Rect): void {
  const ctx = this.ctx;
  const n = list.length;
  const idx = list.sortedIndices;
  const s = this.renderScale;

  let curAlpha = 1;
  ctx.globalAlpha = 1;

  for (let i = 0; i < n; i++) {
    const j = idx[i];
    const bmp = this.cache.acquire(list.handleAt(j), cam.zoom);

    const a = list.alphaAt(j);
    if (a !== curAlpha) { ctx.globalAlpha = a; curAlpha = a; }

    const rot = list.rotAt(j);
    const sx = list.sxAt(j) * cam.zoom * s / bmp.unitScale;
    const sy = list.syAt(j) * cam.zoom * s / bmp.unitScale;
    // world -> viewport, precomposed with the camera affine in one setTransform
    const wx = list.xAt(j), wy = list.yAt(j);
    const px = cam.a * wx + cam.c * wy + cam.e;
    const py = cam.b * wx + cam.d * wy + cam.f;

    if (rot === 0) {
      // Fast path: axis-aligned. ~60% of commands (props, particles, UI).
      ctx.setTransform(sx, 0, 0, sy, px, py);
    } else {
      const cos = Math.cos(rot), sin = Math.sin(rot);
      ctx.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, px, py);
    }
    ctx.drawImage(bmp.source, bmp.ox, bmp.oy);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}
```

One `setTransform` + one `drawImage` per command, one `globalAlpha` write per alpha *change* (the sort groups equal alphas in practice because layers share alpha). No `save`/`restore` anywhere in the hot loop.

3. **Banned outright**, with a lint rule and the render test:
   - `ctx.shadowBlur` — 5–50× cost per call on Safari. Replaced by a pre-blurred `shadowBlob` bitmap.
   - `ctx.filter` — software path on Safari, catastrophic. No exceptions.
   - `createLinearGradient`/`createRadialGradient` inside a draw loop — gradients are created once during a *bake* and are fine there; per-frame creation is banned.
   - `ctx.clip()` — forces a slow path. Scroll lists clip by culling commands mathematically instead.
   - `globalCompositeOperation` other than `source-over` — allowed only for the single `ScreenFx` full-screen flash, once per frame, never per entity. In particular **tinting via `source-in` is banned**; colour variants are baked (§5.11).

4. **Layer separation with different update rates.** Three physical canvases would each add a compositor layer; we use **one canvas** and instead exploit the chunk-tile bake as the static layer. The HUD is redrawn every frame but is only ~40 commands.

5. **`imageSmoothingEnabled = false` is wrong here** — we are drawing smooth vector art scaled between zoom buckets, so smoothing stays on, with `imageSmoothingQuality = 'low'` (the `'high'` setting on Safari is a measurable regression and the visual difference at these scales is nil).

### 8.3 DPR and adaptive quality

```ts
// src/engine/render/Surface.ts
export class Surface {
  readonly canvas: HTMLCanvasElement;
  cssWidth = 0; cssHeight = 0;
  /** Backing-store pixels per CSS pixel. dpr * qualityScale, clamped. */
  renderScale = 1;

  resize(cssW: number, cssH: number, dpr: number, qualityScale: number): void {
    // Cap at 2. A 3x DPR phone gains nothing visible at our art scale and
    // costs 2.25x the fill rate.
    this.renderScale = clamp(dpr * qualityScale, 1, 2);
    // Also cap total backing pixels — a large external monitor at 2x can ask
    // for 8M pixels, which no integrated GPU will fill in 5.5ms.
    const total = cssW * cssH * this.renderScale * this.renderScale;
    if (total > MAX_BACKING_PIXELS) {
      this.renderScale *= Math.sqrt(MAX_BACKING_PIXELS / total);
    }
    this.canvas.width  = Math.round(cssW * this.renderScale);
    this.canvas.height = Math.round(cssH * this.renderScale);
    this.canvas.style.width  = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }
}
```

```ts
// src/engine/diag/AdaptiveQuality.ts
export type QualityTier = 0 | 1 | 2 | 3;   // 0 = best

export interface QualitySettings {
  qualityScale: number;      // multiplies DPR
  particleBudget: number;
  ambientTrafficCount: number;
  shadowsEnabled: boolean;
  renderHzCap: number;       // 0 = display rate
  chunkTileZoomBuckets: number;
}

export class AdaptiveQuality {
  /**
   * Steps DOWN after 45 consecutive frames with p95 frameMs > 18.
   * Steps UP after 600 consecutive frames with p95 frameMs < 12.
   * Asymmetric hysteresis: fall fast, recover slowly, never oscillate.
   * NEVER changes anything gameplay-visible — traffic count is the one
   * borderline case and is capped to a range where it reads as ambience.
   */
  update(frameMs: number): QualityTier;
  readonly current: Readonly<QualitySettings>;
  /** Player override from settings; disables automatic stepping. */
  setManual(tier: QualityTier | null): void;
}
```

Tier table:

| Tier | qualityScale | particles | traffic | shadows | renderHz |
|---|---:|---:|---:|---|---:|
| 0 | 1.0 | 800 | 40 | yes | display |
| 1 | 0.85 | 500 | 30 | yes | 60 |
| 2 | 0.7 | 300 | 20 | yes | 60 |
| 3 | 0.6 | 150 | 12 | ground-only | 60 |

Note `renderHzCap: 60` from tier 1 onward: on a 120 Hz ProMotion iPad, rendering every frame doubles the flush cost for a difference a six-year-old will never perceive. If the device reports a >90 Hz display and the frame graph is tight, we start at tier 0 uncapped and let it fall.

### 8.4 Hotspot register

| # | Hotspot | Symptom | Mitigation | Owner |
|---|---|---|---|---|
| 1 | Per-frame vector path filling | `renderMs` scales with entity count, huge | `ShapeCache` bakes to bitmaps; op-budget test | `ShapeCache` |
| 2 | Static world redrawn every frame | Constant 20 ms+ regardless of action | `ChunkBaker` tiles, 9 blits/frame | `ChunkBaker` |
| 3 | `save`/`restore` churn | Flat cost per command, ~2× slowdown | `setTransform` + manual alpha tracking | `Canvas2DRenderer` |
| 4 | ShapeCache thrash on continuous zoom | `bakesThisFrame` spikes, stutter on zoom | Discrete zoom buckets + per-frame bake cap + nearest-bucket fallback | `ShapeCache` |
| 5 | Cache memory blowup from colour variants | Tab crash on iPad | 16-colour curated palette; 512 px bitmap cap; 20 MB LRU on mobile | `Colorways`, `ShapeCache` |
| 6 | GC pauses from per-frame allocation | Sawtooth frame graph, 30 ms spikes | SoA `DrawList`/particles; `Vec2` scratch pool; cached query arrays; out-params everywhere; **no array/object literals or closures inside any `for` loop in a `fixedUpdate`** | all systems |
| 7 | `shadowBlur` / `filter` | 10× render cost, Safari-specific | Banned by lint + render test; `shadowBlob` bitmap | `tests/render/` |
| 8 | Text rendering (`fillText`) | 0.3–1 ms per unique string | `DigitRenderer` (baked 0–9 glyphs) for all numbers; `TextCache` for the few words | `DigitRenderer` |
| 9 | A* storm on district load | 40 ms hitch | `PathRequestSystem` expansion budget per step | `PathRequestSystem` |
| 10 | Chunk bake hitch | 40–80 ms freeze on fast travel | 1 tile/frame, 3 ms abort, flat-colour placeholder | `ChunkStreamSystem` |
| 11 | WebAudio node churn on button mashing | Crackling, then silence | `VoiceManager` 24-voice cap + per-sfx cooldown + priority stealing | `VoiceManager` |
| 12 | localStorage synchronous writes | 5–20 ms hitch mid-drive | 1.5 s debounce; synchronous flush only on `pagehide` | `SaveManager` |
| 13 | 120 Hz render doubling | Frame budget halves silently on new iPads | `renderHzCap` in tiers 1–3 | `AdaptiveQuality` |
| 14 | High-DPR external monitor | Desktop-only slowdown | `MAX_BACKING_PIXELS` clamp | `Surface` |
| 15 | Query cache rebuild storm | Spike on frames with heavy spawning | Spawn is batched into the `spawn` phase; queries rebuild at most once per step per query | `Query` |

Rule 6 deserves emphasis because it is the one an AI agent writing lots of code will violate by default. The house style for hot loops is: index-based `for` loops (not `for…of` on non-arrays, not `.forEach`, not `.map`/`.filter`), out-parameters for vector math, and preallocated scratch arrays reused across frames.

---

## 9. Extensibility proof

Three features chosen to stress different axes: adding a *movement mode*, adding a *rendering topology*, and adding a *content domain*. If any of these requires touching more than a handful of files, the architecture is wrong and gets revised here.

### 9a. A helicopter that flies over roads

**What breaks in a naive design:** `class Helicopter extends Vehicle` inherits wheels, steering, and road binding, none of which apply. The camera clamps to road bounds. The renderer has no altitude concept, so the helicopter draws behind buildings. Pathfinding tries to route it on roads.

**In this architecture:**

| File | Change | Lines |
|---|---|---:|
| `src/content/vehicles.ts` | Add `helicopter` entry: `navMask: NAV.Air`, seats 4, price, `shape: 'veh.helicopter'`, `cruiseAltitude: 180` | +12 (data) |
| `src/game/art/shapes/vehicles/helicopter.ts` | **New.** Body, canopy, skids, tail boom, rotor-blur ring | +90 |
| `src/game/art/shapes/vehicles/rotor.ts` | **New.** Separate spinning-blade shape on `ActorOverlay` | +30 |
| `src/game/art/index.ts` | Two `reg.define(...)` lines | +2 |
| `src/game/systems/FlightSystem.ts` | **New.** Integrates `flight.altitude` toward `cruiseAltitude`, applies hover bob, detects landing near a helipad | +70 |
| `src/game/systems/order.ts` | One entry in the `simulate` phase | +1 |
| `src/game/systems/RenderCollectSystem.ts` | Shadow scale/offset already reads `transform.z`; add the rotor overlay command | +6 |
| `src/game/components/Flight.ts` | **No change** — exists from day one | 0 |
| `src/game/components/Transform.ts` | **No change** — `z`/`pz` exist from day one | 0 |
| `src/engine/render/Layer.ts` | **No change** — `LayerId.Air` exists from day one | 0 |
| `src/game/systems/DrivingSystem.ts` | **No change** — already `queryNot([...], ['flight'])` | 0 |
| `src/game/systems/RoadAssistSystem.ts` | **No change** — already excludes `flight` | 0 |
| `src/game/world/Pathfinder.ts` | **No change** — air agents fly straight lines and never call it | 0 |
| `src/game/save/SaveSchema.ts` | **No change** — `ownedVehicles: VehicleId[]`, and `VehicleId` is derived from the content table | 0 |

**Total: 2 new files, ~9 lines of edits to 3 existing files.** Not one existing system needs to understand that flight exists, because "is a ground vehicle" is expressed as *the absence of a component* rather than as a type check.

The interpolated render already handles altitude because `z` participates in `SnapshotSystem` and `RenderCollectSystem` maps it to a vertical screen offset plus a shrinking, fading shadow:

```ts
// RenderCollectSystem, existing code — no change needed for the helicopter
const z = t.pz + (t.z - t.pz) * alpha;
if (e.shadow) {
  const k = 1 - Math.min(z * SHADOW_ALT_FALLOFF, 0.6);
  list.push(LayerId.Shadows, y, e.shadow.handle, x, y, t.rot, k, k, k * 0.5);
}
list.push(e.sprite.layer, y, e.sprite.handle, x, y - z * ALT_TO_SCREEN, rot, sx, sy, 1);
```

**Revision this exercise forced (already applied above):** `Transform` carries `z`/`pz` and `LayerId` includes `Air` from day one, even though nothing uses them in v1. Cost: ~15 lines and two bytes per entity. Without them, adding flight later means touching every system that reads a transform.

### 9b. Two-player split-screen

**What breaks in a naive design:** a singleton camera, a singleton `InputManager` with one action state, UI laid out against `window.innerWidth`, a renderer with one implicit full-screen viewport, and a save file with one profile. That is a week-long refactor touching every file.

**In this architecture:**

| File | Change | Lines |
|---|---|---:|
| `src/game/bootstrap.ts` | Build two `PlayerSlot`s; compute viewports (vertical split on landscape tablet) | +25 |
| `src/game/scenes/PlayerSelectScene.ts` | **New.** One-vs-two-player picker with device assignment | +120 |
| `src/engine/input/ViewportRouter.ts` | **No change** — already assigns each pointer a `playerId` by viewport hit-test | 0 |
| `src/engine/input/InputManager.ts` | `bindDevice(1, …)`; per-player action state arrays already indexed by player | +15 |
| `src/game/systems/CameraSystem.ts` | **No change** — already `for (const p of ctx.players)` | 0 |
| `src/game/systems/RenderCollectSystem.ts` | **No change** — already loops players, culls per camera, fills `p.drawList` | 0 |
| `src/game/scenes/CityScene.collect()` | Already pushes one `RenderPass` per player | 0 |
| `src/engine/render/Canvas2DRenderer.ts` | Set a viewport clip rect per pass — one `save`/`clip`/`restore` **per pass**, not per command | +8 |
| `src/game/ui/Hud.ts` | **No change** — already lays out against `slot.viewport` | 0 |
| `src/game/audio/AudioDirector.ts` | Listener = midpoint of the two cameras; widen the pan scale | +10 |
| `src/game/save/SaveSchema.ts` | v(n)→v(n+1): `profile` → `profiles: [PlayerProfile, PlayerProfile?]` | +20 |
| `src/game/save/SaveMigrations.ts` | One migration wrapping the old profile into `profiles[0]` | +12 |
| `src/game/systems/PlayerControlSystem.ts` | **No change** — already reads `ctx.input.axis2(slot.id, 'move')` per slot | 0 |
| `src/engine/diag/AdaptiveQuality.ts` | Start one tier lower when `players.length === 2` | +3 |

**Total: 1 new file, ~93 lines across 6 existing files, zero restructuring.**

This only works because of three **non-negotiable day-one invariants**, which cost almost nothing to honour now and are prohibitively expensive to retrofit:

> **I1.** `ctx.players` is an array. No code may index `players[0]` outside `bootstrap.ts` and single-player-only scenes. Systems iterate.
>
> **I2.** All UI layout and all screen-space math takes a `Rect` viewport parameter. **No file outside `Surface.ts` and `Viewport.ts` may read `window.innerWidth`/`innerHeight` or `canvas.width`/`height`.** Lint-enforceable via `no-restricted-properties`.
>
> **I3.** Rendering happens exclusively through `Renderer.submit(pass)` where a pass carries its own camera, viewport, and draw list. There is no ambient "current camera".

Split-screen roughly doubles `renderMs` (two culled draws of overlapping content) but not `simMs` (one world). The budget in §8.1 has 4.3 ms of headroom and `AdaptiveQuality` starts a tier lower, which lands two-player at tier 1: DPR ×0.85, 500 particles, 30 traffic. That fits.

### 9c. A new harbour district with a ferry route

**What breaks in a naive design:** the road graph assumes cars, so a boat needs a parallel navigation system; the pathfinder has no concept of who may traverse what; the chunk baker only knows how to draw asphalt.

**In this architecture:**

| File | Change | Lines |
|---|---|---:|
| `src/content/districts/harbor.ts` | **New.** Nodes, edges (`modes: NAV.Water` for channels, `NAV.Road` for quays), buildings, stops, terminals | +400 (data) |
| `src/content/districts/index.ts` | One registry entry + unlock requirement | +4 |
| `src/content/vehicles.ts` | `ferry` entry: `navMask: NAV.Water`, 12 seats, price | +12 |
| `src/content/routes.ts` | Ferry route: ordered terminal list, dwell time, `navMask: NAV.Water` | +10 |
| `src/game/art/shapes/vehicles/ferry.ts` | **New.** Hull, wheelhouse, deck rails, wake anchor | +80 |
| `src/game/art/shapes/city/water.ts` | **New.** Water fill + animated shore band | +45 |
| `src/game/art/shapes/city/dock.ts` | **New.** Terminal, pilings, ramp | +60 |
| `src/game/art/index.ts` | Three `define` lines | +3 |
| `src/game/world/ChunkBaker.ts` | Water pass before the road pass: fill `chunk.waterPolys`, then stroke `NAV.Water` edges as channel shading | +28 |
| `src/game/world/Chunk.ts` | `waterPolys: Float32Array[]` field | +1 |
| `src/game/world/DistrictLoader.ts` | Route water polygons from district data into chunks | +12 |
| `src/game/world/Pathfinder.ts` | **No change** — `mask` is already a parameter of `find` and `neighbors` | 0 |
| `src/game/systems/RouteSystem.ts` | **No change** — a route is an ordered stop list plus a nav mask | 0 |
| `src/game/systems/PathFollowSystem.ts` | **No change** — spline following is mode-agnostic | 0 |
| `src/game/systems/RoadAssistSystem.ts` | **No change** — already passes `e.roadBinding.navMask` to `nearestEdge` | 0 |
| `src/game/systems/DrivingSystem.ts` | Ferries need higher drag and lower turn rate: that is `VehicleStats` data, not code | 0 |
| `src/game/components/EmitterRef.ts` | **No change** — wake is an `EmitterDef` in content | 0 |
| `src/game/progression/Unlocks.ts` | One declarative unlock rule (data) | +6 |
| `src/game/save/SaveSchema.ts` | **No change** — `unlockedDistricts: DistrictId[]` already exists | 0 |

**Total: 4 new files (3 of them art, 1 content), ~54 lines of real code across 3 existing files.** Everything else is data.

**Revision this exercise forced (already applied above):** `RoadEdge.modes: NavMask` and the `NAV` bitflags exist from day one, and `Pathfinder.find` / `RoadGraph.neighbors` / `RoadGraph.nearestEdge` all take a mask parameter. In v1 every edge is `NAV.Road | NAV.Foot` and every vehicle passes `NAV.Road`, so the feature is invisible. Cost: one integer per edge and one parameter on three functions. Without it, ferries require either a second parallel graph (duplicating the pathfinder, the follower, and the spatial index) or a graph-wide refactor.

### 9d. Summary of the day-one insurance policy

Three cheap decisions carry all three future features:

| Insurance | Cost in v1 | Saves |
|---|---|---|
| `Transform.z` + `LayerId.Air` + `Flight` component slot | ~15 lines, 8 bytes/entity | Helicopters, jumps, ramps, drone deliveries, any verticality |
| `ctx.players: PlayerSlot[]` + viewport-relative UI + `RenderPass` | ~40 lines | Split-screen, picture-in-picture, minimap-as-a-pass, replay viewer |
| `NavMask` on edges + mask parameter on nav APIs | ~10 lines | Ferries, trains, pedestrian paths, bike lanes, one-way streets, toll roads |

Everything else in this document is structure that pays for itself immediately. These three are speculative, and they are the only speculation I would accept in v1 — each is a data field plus a parameter, not an abstraction.

---

## 10. Boot sequence

The order matters and is easy to get subtly wrong, so it is specified:

```ts
// src/boot.ts
export async function boot(): Promise<void> {
  const flags = parseHashFlags(location.hash);          // seed, dev, gallery, scene

  // 1. Platform probe before anything sizes itself.
  const device = DeviceInfo.probe();                    // dpr, memory hint, touch, iOS, refreshRate

  // 2. Surface + renderer. Nothing can draw before this.
  const surface = new Surface(document.getElementById('stage') as HTMLCanvasElement);
  const renderer = new Canvas2DRenderer(surface);
  const quality = new AdaptiveQuality(device);
  surface.resize(innerWidth, innerHeight, device.dpr, quality.current.qualityScale);

  // 3. Registries. Shape definitions must exist before any cache or entity.
  const shapes = new SpriteRegistry();
  registerAllShapes(shapes);                            // src/game/art/index.ts
  const shapeCache = new ShapeCache({ registry: shapes, ...budgetsFor(device) });

  // 4. Save. Loaded BEFORE the world, because it decides which district loads.
  const save = new SaveManager<SaveFile>(SAVE_OPTS);
  const loaded = save.load();

  // 5. Deterministic root RNG. Seed from the save (stable across sessions) or
  //    from the URL flag (reproducible bug reports).
  const rng = new Rng(flags.seed ?? loaded.data.worldSeed);

  // 6. World + context. Systems are registered but not yet running.
  const ctx = buildGameContext({ device, surface, renderer, shapes, shapeCache,
                                 save, saveData: loaded.data, rng, quality, flags });

  // 7. Loop, wired to the scene stack and system runner.
  const loop = new GameLoop({
    fixedUpdate: (dt) => { ctx.time.step++; ctx.time.sim = ctx.time.step * dt;
                           ctx.input.update(dt); ctx.runner.fixedUpdate(dt);
                           ctx.scenes.fixedUpdate(dt); ctx.simScheduler.update(dt); },
    variableUpdate: (dtScaled, dtReal) => {
                           ctx.time.real += dtReal;
                           ctx.tweens.update(dtReal, dtScaled);
                           ctx.uiScheduler.update(dtReal);
                           ctx.runner.lateUpdate(dtScaled);
                           ctx.scenes.lateUpdate(dtScaled);
                           ctx.input.endFrame(); },
    render: (alpha, dtReal) => {
                           const passes = ctx.framePasses; passes.length = 0;
                           ctx.scenes.collect(alpha, passes);
                           renderer.beginFrame();
                           for (const p of passes) renderer.submit(p);
                           renderer.endFrame();
                           quality.update(loop.stats.frameMs); },
    onFrameEnd: (s) => ctx.profiler.frameEnd(),
  }, { fixedHz: 60, maxSubSteps: 5 });

  // 8. Platform lifecycle. Must be installed before the first frame.
  installVisibilityHandling(ctx, loop);
  installResizeHandling(ctx, surface, quality);
  if (__DEV_TOOLS__ || flags.dev) installDevTools(ctx);

  // 9. First scene. BootScene warms the shape cache with a progress bar, then
  //    replaces itself. Audio is NOT unlocked here — it unlocks on the first
  //    real pointerdown, which is the Play button in TitleScene.
  ctx.scenes.reset(flags.gallery ? new GalleryScene() : new BootScene(), loaded);

  loop.start();
}
```

Two ordering constraints that cause real bugs if violated: **shapes must be registered before `ShapeCache` is constructed** (it sizes its handle table from the registry), and **the save must load before the world** (the save names the district and carries the world seed, so loading a default district first means building and discarding a whole city).

---

## 11. Open questions for the other lenses

Flagging where this architecture makes a demand on, or offers an opportunity to, the other specialists:

1. **Colour palette must be curated to 16 named colourways, not a free picker** (§5.11). This is a hard technical constraint from the ShapeCache memory budget. It is also better art direction, but the art lens should know it is not negotiable without a renderer change.
2. **All numbers in the HUD render through `DigitRenderer`, not a system font.** The UX lens should design around chunky procedural digits and icons; word text is available but each unique string costs a cache entry, so it should be rare and short.
3. **Control scheme is swappable at the `ActionMap` level** (`virtual-stick` | `follow-finger` | `tap-target`). The UX lens can specify any of the three, or a settings toggle, without engine work. All three produce the same `move` axis.
4. **`assistStrength` is a live 0–1 tunable** (§6.3). If the design wants difficulty to scale with player age or progress, that is a data change.
5. **The economy is testable before it is playable.** `npm run sim` answers "how long until the second vehicle" for any tuning of `content/upgrades.ts`. The design lens should give me target minutes-to-unlock numbers and I will tune the content tables against the `child` and `flailing` policies.
6. **Particle and traffic counts degrade under `AdaptiveQuality`** (§8.3). Nothing gameplay-critical may be communicated by a particle effect or by ambient traffic, because on a tier-3 device there will be fewer of both.

---

## 12. Build order

The sequence that keeps the game runnable and testable at every step:

| Milestone | Deliverable | Gate |
|---|---|---|
| **M0** Skeleton | Vite + TS + CI + Pages deploy; `GameLoop` drawing one moving rectangle | Green frame graph on a real iPad |
| **M1** Render core | `SpriteRegistry`, `ShapeCache`, `DrawList`, `Canvas2DRenderer`, `Camera`, `#gallery` | 500 cached sprites at 60fps on reference hardware |
| **M2** ECS + input | `World`, `System`, `SystemRunner`, `InputManager`, `ActionMap`; a car you can drive on a blank plane | Same car drivable by touch, keyboard, and gamepad |
| **M3** World | `RoadGraph`, `ChunkStore`, `ChunkBaker`, `SpatialHash`, `RoadAssistSystem`; one hand-authored district | Full-screen city at 60fps; road assist feels forgiving |
| **M4** Core loop | Passengers, `RideRequest`, pickup, dropoff, `Economy`; money goes up | `runHeadless` produces a sane `SimReport` |
| **M5** Feel | Audio, particles, springs, camera juice, HUD, `DigitRenderer` | Playtest with an actual six-year-old |
| **M6** Progression | Save/load, shop, garage, upgrades, second vehicle, unlocks | `flailing` policy reaches vehicle 2 in <20 min |
| **M7** Hardening | `AdaptiveQuality`, golden test, migrations, offline SW, parent gate | Full test suite green; ships |

M0–M2 are pure engine and are where the architecture is proved or disproved. If `ShapeCache` does not deliver the numbers in §8.1 at M1, that is the moment to invoke the escape hatch in §1.2 — before 15,000 lines of game code exist on top of it.