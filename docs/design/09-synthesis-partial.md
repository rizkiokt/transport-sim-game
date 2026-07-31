```
  dashPhase: number;           // precomputed chain arc length for continuous dashes
  trimStart: number; trimEnd: number;   // shorten by max incident width/2 at junctions
}

export interface Stop {
  id: number; nodeId: number;
  landmarkShape: 'cone'|'star'|'house'|'ball'|'tree'|'fish'|'moon'|'drum';
  landmarkColor: string;
  reactive: boolean;           // only the 8 landmark buildings are reactive
}

export class RoadGraph {
  readonly nodes: RoadNode[];
  readonly edges: RoadEdge[];
  readonly stops: Stop[];
  neighbors(nodeId: number, mask: NavMask): readonly number[];
  /** Out-param, zero allocation. Returns edgeId or -1. */
  nearestEdge(x: number, y: number, mask: NavMask, out: NearestHit): number;
  projectToEdge(edgeId: number, x: number, y: number, out: Projection): void;
}

export class DistanceMatrix {
  /** 24×24 Uint16 of graph distance in BLOCKS×10 (fixed point). BFS at boot, <1 ms. */
  blocks(stopA: number, stopB: number): number;
}

export class Pathfinder {
  /** A* with a per-step expansion budget. mask is a parameter from day one. */
  find(fromNode: number, toNode: number, mask: NavMask, out: number[]): boolean;
}
```

**Day-one insurance (the only three speculative decisions accepted in v1):**

| Insurance | Cost in v1 | What it saves |
|---|---|---|
| `Transform.z` / `pz` + `LayerId.Air` + an unused `Flight` component slot | ~15 lines, 8 bytes/entity | Helicopters, ramps, jumps, drone deliveries, any verticality |
| `ctx.players: PlayerSlot[]` + viewport-relative UI + `RenderPass` carrying its own camera/viewport/drawlist | ~40 lines | Split-screen, picture-in-picture, replay viewer |
| `NavMask` on edges + a mask parameter on `find` / `neighbors` / `nearestEdge` | ~10 lines | Ferries, trams, pedestrian paths, one-way streets |

Each is a data field plus a parameter, not an abstraction. **No other speculation is permitted in v1.**

**Non-negotiable invariants:**
- **I1.** `ctx.players` is an array. No code indexes `players[0]` outside `bootstrap.ts`.
- **I2.** All UI layout and screen-space math takes a `Rect` viewport parameter. **No file outside `Surface.ts` and `Viewport.ts` may read `window.innerWidth`/`innerHeight` or `canvas.width`/`height`.** `Surface.syncToViewport()` reads its own element's `getBoundingClientRect()` via a `ResizeObserver` (on iOS, `innerHeight` changes as the URL bar collapses and causes a resize storm mid-drive).
- **I3.** Rendering happens exclusively through `painter.submit(pass)`. There is no ambient "current camera".

### 13.8 Chunks and streaming

```
CHUNK_SIZE_M      = 48          // one chunk ≈ 1.1 blocks
TILE_PX           = 1152        // backing px at zoom 1 (24 px/m × 48 m)
CHUNK_RING        = 3 × 3       // visible ring; ≤ 1.4× viewport coverage
TILE_POOL         = 16 tiles, PREALLOCATED ONCE AT BOOT and recycled.
                    Never one canvas per chunk.
BAKE_BUDGET       = 1 tile per frame, aborted at 3 ms
MAX_EDGES_PER_CHUNK = 120       // enforced by a district linter at build time
DECAL_CAP         = 256 (tyre tracks, puddle marks, candy trail) with dirty-tile
                    invalidation; otherwise "tracks that fade over 8 s" is an
                    unbounded per-frame draw list
```

Fast camera moves show a flat-colour placeholder tile for at most 2 frames.

### 13.9 Boot sequence

```ts
// src/boot.ts
export async function boot(): Promise<void> {
  // 0. Audio unlock listener FIRST — must be a direct DOM listener, capture phase,
  //    synchronous inside the gesture task (§12.1).
  installAudioUnlock();

  const flags = parseHashFlags(location.hash);   // seed, dev, gallery, reset

  // 1. Platform probe. Only fields that exist on the primary target.
  //    navigator.deviceMemory does NOT exist on Safari; refreshRate has no API.
  const device = DeviceInfo.probe();  // { dpr, touch, isIOS, hardwareConcurrency, screenPx }
  //    memoryTier: isIOS ? 'conservative'
  //              : (deviceMemory ?? (hardwareConcurrency >= 8 ? 8 : 4)) >= 8 ? 'high' : 'low'

  // 2. Surfaces + painter. Nothing can draw before this.
  const worldSurface = new Surface(el('#world'));
  const hudSurface   = new Surface(el('#hud'));
  const quality = new AdaptiveQuality(device);   // tier chosen from device, not measured yet
  worldSurface.syncToViewport(quality, { maxScale: device.isIOS ? 1.5 : 2.0 });
  hudSurface.syncToViewport(quality,   { maxScale: 2.0, ignoreQualityScale: true });
  const painter = new Canvas2DPainter(worldSurface, hudSurface);

  // 3. Registries. Shape defs must exist before the cache is constructed
  //    (it sizes its handle table from the registry).
  const shapes = new SpriteRegistry();
  registerAllShapes(shapes);                     // an explicit CALL — no module-scope
                                                 // side effects anywhere in src/game/art/**
  const shapeCache = new ShapeCache({ registry: shapes,
    maxAtlases: device.isIOS ? 3 : 6, atlasSize: 2048 });

  // 4. Settings, then profiles, then save. The save names the district and carries
  //    the worldSeed — loading a default district first means building and
  //    discarding a whole city.
  const settings = SettingsStore.load();         // SEPARATE blob from SaveFile
  const profiles = SaveManager.listProfiles();
  const active   = profiles.length > 1 ? await ProfileScene.pick(profiles) : profiles[0];
  const loaded   = SaveManager.load(active);

  // 5. Deterministic root RNG.
  const rng = new Rng(flags.seed ?? loaded.data.worldSeed);

  // 6. Context. Systems registered, not running.
  const ctx = buildGameContext({ device, worldSurface, hudSurface, painter, shapes,
                                 shapeCache, settings, save: loaded, rng, quality, flags });

  // 7. Loop (§13.4).
  const loop = new GameLoop(ctx);

  // 8. Lifecycle BEFORE the first frame.
  installVisibilityHandling(ctx, loop);   // pause, save, audio resume
  installResizeHandling(ctx);             // ResizeObserver, not window.onresize
  installErrorHandling(ctx);              // window.onerror + unhandledrejection → ErrorRing
  registerServiceWorker();                // relative scope; see §16.3
  if (flags.dev) await import('./dev/tools').then(m => m.install(ctx));

  // 9. First scene. BootScene warms the atlas in ≤6 ms slices with a procedural
  //    spinner, MEASURES REFRESH RATE over 60 frames, then hands off.
  ctx.scenes.reset(flags.gallery ? new GalleryScene() : new BootScene(), loaded);
  loop.start();
}
```

**Boot budget, hard gate:** time-to-first-interaction **≤ 2.0 s** on the worst reference device. Bake in slices of ≤ 6 ms per frame across the boot rAF loop, ordered **player vehicle → road/ground → nearest 30 buildings → everything else**. The child can drive at ~1.2 s while the city is still populating in. The loading spinner is itself procedural (drawn with `paths.ts`), which doubles as the first smoke test of the whole pipeline.

### 13.10 Save schema and persistence

```ts
// src/game/save/SaveSchema.ts
export interface SaveV1 {
  version: 1;
  worldSeed: number;
  createdAt: number;             // epoch ms, for the ITP refresh heuristic
  lastSeen: number;

  /** ARRAY FROM DAY ONE (invariant I1). Up to 3. */
  profiles: PlayerProfile[];
  activeProfile: number;

  /** Per-named-stream RNG state, so traffic and passengers don't replay. */
  rngStreams: Record<'traffic'|'requests'|'decor'|'castPick', [number,number,number,number]>;

  /** Corruption DETECTOR only — never a rejection reason. */
  checksum: string;
}

export interface PlayerProfile {
  avatarVehicle: VehicleId;      // profiles are chosen by car silhouette + colour, no text
  avatarPaint: CosmeticId;

  coins: number;
  stars: number;

  ownedVehicles: VehicleId[];
  activeVehicle: VehicleId;
  upgradeLevels: Record<UpgradeId, number>;    // 'speed' | 'money' | 'seats'

  cosmetics: {
    owned: CosmeticId[];
    equipped: Record<VehicleId, Partial<Record<CosmeticKind, CosmeticId>>>;
  };

  stickers: StickerId[];
  unlockedDistricts: DistrictId[];
  activeDistrict: DistrictId;

  day: number;
  deliveriesToday: number;
  missions: Array<{ id: string; progress: number; rerolled: boolean }>;
  lifetime: Record<MetricId, number>;          // drives stickers and missions

  assistLevel: 1 | 2 | 3;
  adaptiveAssistTriggered: boolean;
  handedness: 'left' | 'right';
  seenSetPieces: string[];                     // one-shot cinematics
  lastEventDay: string;                        // LOCAL date string
  giftClaimedOn: string;                       // LOCAL date string
}

// SEPARATE blob, separate version — wiping progress must not reset volume.
export interface SettingsV1 {
  version: 1;
  soundState: 0 | 1 | 2;
  musicVolume: number; sfxVolume: number;
  gentleMode: boolean | 'auto';
  alwaysDaytime: boolean;
  cruiseMode: boolean;
  haptics: boolean;
  qualityTier: 0|1|2|3|null;      // null = automatic
  sessionMinutes: 0|10|15|20|30;
}
```

**Persistence rules:**
- Write on **every economic event** (delivery, purchase, day end, district change), debounced 500 ms, plus on `visibilitychange` and `pagehide`. **Never on a rAF tick.**
- **Checksum mismatch never rejects a save.** On mismatch: snapshot the blob to `save.backup`, load it anyway, repair missing fields with defaults. A static site has no secret, so a checksum stops nobody — but rejecting on it would let a benign localStorage quirk destroy a child's garage.
- Migrations are pure `migrate[n]: SaveN → SaveN+1`. **A failed migration never wipes**: it snapshots to `save.backup` and rebuilds a best-effort save preserving **coins, vehicles and stickers**.
- **`QuotaExceededError`** (Safari Private Browsing, full storage): catch, fall back to an in-memory store, and set a flag surfaced in the parent area as "progress is not being saved right now".
- **Multi-tab:** last-write-wins, with a `storage` event listener that reloads the profile if another tab wrote it.
- **iOS ITP 7-day eviction is the single biggest threat to saves.** WebKit purges script-writable storage after 7 days of Safari use without interaction on the origin — a child who plays on Saturdays loses everything. Three mitigations, all shipping:
  1. `manifest.webmanifest` with `display: standalone` from day one, and "Add to Home Screen" as a first-run parent instruction. Home-screen web apps are exempt from the cap (and get fullscreen free, and lose Safari's edge-swipe-back gesture that would otherwise navigate away mid-drive).
  2. On boot, if `lastSeen` is > 6 days old, silently re-write the save to refresh the eviction clock.
  3. **Save Code** in the parent area: base64 of the save JSON (~1.5 KB) as selectable text plus a copy button, and a paste-to-import field. Not a dev-console command — a parent-facing feature.

### 13.11 Error handling and crash recovery

One `undefined` in one system kills the rAF loop, the screen freezes, and on a serverless static site nobody can diagnose it.

- `GameLoop` wraps `fixedUpdate` and `render` in try/catch (§13.4).
- `ErrorRing`: a 20-entry ring buffer in localStorage (message, stack, system, build id, step).
- On throw: **disable the offending system for the rest of the session**. If the same system throws 3 times, transition to **`OopsScene`** — a friendly animated character, one word, one giant button that reloads and restores the last good save.
- `window.onerror` and `unhandledrejection` route to the same place.
- `#dev` surfaces the ring buffer so a parent can screenshot it. **This is the entire crash-reporting strategy** for a product that makes zero network requests.

### 13.12 Determinism — scoped to what it buys

Determinism buys exactly three things: reproducible bug repro from a seed in a URL, the headless economy sweep, and freedom from wall-clock timers (so a slept tablet resumes correctly). None of them require cross-build bit-exactness.

**Cross-build golden-digest equality is deleted.** `Math.sin/cos/atan2/pow/exp` are not required by ECMAScript to be correctly rounded; V8's implementations differ across versions and between x86 and arm64. A driving sim integrates heading through `cos`/`sin` every step; a 1-ULP divergence at step 5 amplifies chaotically, and quantising to 1/64 absorbs last-bit noise, not chaotic amplification. The test would pass on the author's machine, fail on CI, and be turned into a rubber stamp within a month.

**What is tested instead:**
1. `expect(a.digest).toBe(b.digest)` — **same-process**, catches real nondeterminism (`Math.random`, `Date.now`, Set iteration, uninitialised memory) and never needs regenerating.
2. **Save/load round-trip determinism** — run 1800 steps, serialise, construct a *fresh* `GameContext` from the payload, run 1800 more; the digest must equal an uninterrupted 3600-step run. This single test is worth more than any golden fixture: unsaved RNG streams, unserialised transient components and reset spawn timers all live here.
3. **Property assertions** on `SimReport`: `moneyEarned > 0`, `ridesCompleted ∈ [lo, hi]`, `timeIdleFraction < 0.5`, `money` non-decreasing under every policy.

**Lint-enforced determinism rules** over `src/game/systems/**`, `src/game/world/**`, `src/game/progression/**`:

```js
'no-restricted-properties': ['error',
  { object:'Math', property:'random', message:'Use ctx.rng — sim must be deterministic.' },
  { object:'Date', property:'now', message:'Use ctx.time.sim.' },
  { object:'performance', property:'now', message:'Use ctx.time.sim.' },
  { object:'window', property:'setTimeout' }, { object:'window', property:'setInterval' },
  { object:'window', property:'requestAnimationFrame' },
],
'no-restricted-globals': ['error',
  { name:'requestAnimationFrame' }, { name:'setTimeout' }, { name:'setInterval' },
],
'no-restricted-syntax': ['error',
  { selector: "MemberExpression[property.name='random']", message:'Use ctx.rng.' },
],
```

Plus four rules enforced by review:
1. No iteration over a `Set`/`Map` keyed by object identity inside `fixedUpdate`. Key by `EntityId` and iterate dense arrays.
2. Entity ids are monotonic and **never reused** (`World.free` is a debug-only pool, disabled by default).
3. `fixedUpdate` reads only `slot.cameraSnapshot` (§13.5).
4. `ctx.time.sim = step * FIXED_DT` from an integer counter, never `+= dt`.

---

## 14. Performance budget & quality tiers

### 14.1 Reference devices

| | **iPad 8th gen (A12)** | **2019 Celeron N4000 Chromebook** |
|---|---|---|
| CSS viewport | 1180 × 820 | 1366 × 768 |
| DPR | 2 | 1 |
| World `renderScale` | **1.5** (capped on iOS) | 1.0 × tierScale |
| Backing store (world) | 1770 × 1230 = 2.18 Mpx | 1366 × 768 = 1.05 Mpx |
| Default tier | **0** | **2** (`hardwareConcurrency <= 2 && !isIOS`) |

The Chromebook is roughly 4–6× slower than the A12 in Canvas2D. It gets its own column, not a shared budget.

### 14.2 Constants (`src/engine/constants.ts` — every one of these is a named export with a justification comment)

```
WORLD_UNIT_M          = 1
ZOOM_1_PX_PER_M       = 24
ZOOM_BUCKETS          = [0.55, 0.80, 1.15, 1.60]
VIEW_HEIGHT_MIN_M     = 30
VIEW_HEIGHT_MAX_M     = 46
CAR_MIN_RENDER_PX     = 60          // asserted; caps future top speed at ~16 m/s
CHUNK_SIZE_M          = 48
TILE_PX               = 1152
CHUNK_RING            = 3
TILE_POOL             = 16
ATLAS_SIZE            = 2048
MAX_ATLASES           = isIOS ? 3 : 6
MAX_CANVAS_BYTES      = 96 * 1024 * 1024   // M1 gate on the reference iPad
MAX_BACKING_PIXELS    = 4_500_000
FIXED_DT              = 1/60
MAX_SUB_STEPS         = 2
ASTAR_EXPANSION_BUDGET= 400 nodes/step
SHADOW_ALT_FALLOFF    = 0.004
ALT_TO_SCREEN         = 0.55
```

### 14.3 Frame budget — iPad 8, tier 0

Target scene: 1 player vehicle, 12 ambient vehicles, 24 rendered characters, 120 static props visible, 250 particles, 9 chunk tiles, full HUD.

| Stage | Budget | Notes |
|---|---:|---|
| Input sample + action resolve | 0.2 ms | one sample per frame, latched edges |
| `fixedUpdate` × 1 | **3.0 ms** | |
| — Snapshot | 0.15 ms | ~500 transform copies |
| — PlayerControl + Driving + RoadAssist + JunctionAssist | 0.6 ms | includes ~15 `nearestEdge` queries |
| — AI traffic + PathFollow (12 NPCs, spline followers) | 0.5 ms | one distance test each, no cones |
| — PathRequest (budgeted A*) | 0.4 ms | hard-capped by expansion budget |
| — SpatialHash rebuild | 0.15 ms | |
| — Collision (soft, hash broadphase) | 0.4 ms | ~200 pair tests |
| — Gameplay (pickup/dropoff/economy/progression/hints) | 0.3 ms | mostly early-outs |
| — Chunk stream + spawn + cleanup + event drain | 0.5 ms | excludes baking |
| `lateUpdate` | **1.5 ms** | camera 0.05, fxTweens 0.15, springs/bob 0.2, particles 0.45, audio reaction 0.2, HUD sync 0.2, misc 0.25 |
| DrawList build + cull | 0.6 ms | ~600 commands emitted |
| Radix sort | 0.15 ms | 3 passes over 600 `Uint32` |
| **World canvas flush** | **5.2 ms** | ~600 `drawImage` + 9 tiles |
| **Grade pass (one `multiply` rect)** | **1.2 ms** | at world renderScale, world layer only |
| HUD canvas draw | 0.6 ms | ~40 commands, procedural digits |
| **Subtotal** | **12.5 ms** | |
| Headroom (GC, compositor, Safari overhead) | 4.2 ms | ~25% |
| **Frame total** | **16.7 ms** | |

**Fill-rate budget — the number that actually decides whether this works.** Draw-call counts do not predict Canvas2D performance on an A12; textured fill does.

> **Total covered backing-store pixels ≤ 3.0 × backing-store size per frame** (tier 0), 2.2× (tier 1), 1.7× (tier 2), 1.3× (tier 3).

Instrumented in the overlay by summing `sx*sy*bitmapArea` at flush time and displayed live on the tablet. A dev-mode counting Painter reports draw calls **and** approximate covered pixels **per layer**. Secondary caps: ≤ 900 draw calls/frame at tier 0, ≤ 450 at tier 3.

`imageSmoothingEnabled = true`, `imageSmoothingQuality = 'low'` (we scale smooth vector art between zoom buckets; `'high'` is a measurable Safari regression for nil visual gain).

**Amortised costs, each with a hard cap:** chunk baking ≤ 1 tile/frame aborted at 3 ms; shape baking ≤ 6 shapes/frame outside `BootScene`; save flush debounced 500 ms, synchronous only on `pagehide`.

**Total canvas bytes are counted and displayed in the overlay.** iOS Safari enforces a per-tab canvas backing-store ceiling; past it, previously-drawn canvases are **silently discarded and draw as transparent** — the "everything goes blank white" bug, which is quieter and worse than a crash. Hence: shelf-packed atlases (never one canvas per baked shape), a preallocated tile pool (never one canvas per chunk), eviction **by atlas** with compaction at scene transitions, and an **M1 gate that fails if total canvas bytes exceed 96 MB on the reference iPad**.

`OffscreenCanvas` is feature-detected once at boot (`bake.ts` exposes `createBakeSurface(w,h): OffscreenCanvas | HTMLCanvasElement`); iOS shipped it in 16.4, so an older iPad falls back to a detached `<canvas>`. **No worker-based baking** — transfer cost plus no `ImageBitmap` guarantee. Note also: GitHub Pages cannot set response headers, so there is no COOP/COEP, no cross-origin isolation, and **no `SharedArrayBuffer`, permanently.** Nobody may design around shared memory.

### 14.4 Quality tiers

```ts
export type QualityTier = 0 | 1 | 2 | 3;
export interface QualitySettings {
  qualityScale: number;      // multiplies DPR
  particleBudgetAmbient: number;
  ambientTrafficCount: number;
  overdrawBudget: number;
  windowSparkles: boolean;
  cloudShadows: boolean;
  renderHzCap: 0 | 60;       // 0 = display rate
}
```

| Tier | qualityScale | ambient particles | traffic | overdraw | sparkles | cloud shadows | renderHz |
|---|---:|---:|---:|---:|---|---|---:|
| 0 | 1.00 | 250 | 12 | 3.0× | yes | yes | 60 |
| 1 | 0.85 | 180 | 10 | 2.2× | yes | yes | 60 |
| 2 | 0.72 | 120 | 8 | 1.7× | no | yes | 60 |
| 3 | 0.60 | 70 | 6 | 1.3× | no | no | 60 |

`renderScale = clamp(dpr * qualityScale, 0.55, isIOS ? 1.5 : 2.0)`. The lower bound is **0.55, not 1.0** — with a 1.0-DPR Chromebook, a floor of 1.0 makes tiers 1–3 all resolve to renderScale 1 and kills the most important lever on the weakest device. Sub-1 renderScale with CSS upscaling looks fine with heavy outlines and smoothing on. The `MAX_BACKING_PIXELS` sqrt-rescale is applied **before** the clamp.

**Render is always capped at 60 Hz** (skip alternate rAF callbacks on a 120 Hz panel). At 120 Hz the budget is 8.3 ms and the subtotal above is 12.5 ms, so an uncapped ProMotion iPad would start at tier 0, stutter for a second, and visibly demote. The budget is stated as a function of refresh rate, and 60 is the chosen rate.

**Degrade ordering within a tier step is fixed and stated:** ambient particles → traffic count → cloud shadows → window sparkles → renderScale → grade pass. **Render Hz is never a tier lever** — halving refresh doubles touch-to-photon latency, and latency is precisely the axis on which a child with poor fine motor control suffers most.

**Hysteresis (a well-defined criterion):** p95 frame time over the **trailing 120 frames**, **evaluated every 30 frames**. Step **down** one tier if p95 > 18 ms on **two consecutive evaluations** (~1 s). Step **up** one tier if p95 < 11 ms on **20 consecutive evaluations** (~10 s). **Suppress all evaluation for 90 frames** after a district load, a tab resume, or a tier change (bake storms are not a steady-state signal). **Never change tier while a cinematic or celebration is live.**

**Honest claim about what tiers change:** tier changes do not alter the simulation, **with one exception** — `ambientTrafficCount`, clamped to `[6, 12]`, a range validated in headless to change `coinsPerMin` by **< 5%**. That check runs in `npm run sim`. The claim "never changes anything gameplay-visible" is false and is not made.

### 14.5 Two particle pools

`Fx.Essential` — reward burst, pickup sparkle, dropoff confetti, coin cascade. **Hard reserve of 60 particles, never scaled by tier.** The coin burst on a completed delivery is the single most important feedback signal in a game built for a pre-reader; it is unambiguously a particle effect, and a single global budget would force it to be starved by rain.

`Fx.Ambient` — exhaust, leaves, dust, rain, off-road grass. Scaled by tier, oldest-first eviction.

`EmitterDef.priority: 'essential' | 'ambient'` is a required field. Struct-of-arrays pools (`x, y, vx, vy, life, maxLife, size, rot, vrot, colorIdx, spriteIdx, kind`), one update loop, one batched draw per sprite/composite pair, **no per-particle `save()`/`restore()`, no per-particle `rotate()`** (16 pre-rotated sprite frames). Rain and snow are a pre-rendered tiling pattern scrolled by an offset, never per-drop draws.

### 14.6 Hotspot register

| # | Hotspot | Symptom | Mitigation | Owner |
|---|---|---|---|---|
| 1 | Per-frame vector path filling | render time scales with entity count | `ShapeCache` bakes to atlases; op-budget test | `ShapeCache` |
| 2 | Static world redrawn every frame | constant 20 ms+ | `ChunkBaker` tiles, 9 blits/frame | `ChunkBaker` |
| 3 | `save`/`restore` churn | ~2× flat slowdown | `setTransform` + manual alpha tracking | `Canvas2DPainter` |
| 4 | Total canvas bytes on iOS | **silent transparent draws** | atlases + preallocated tile pool + 96 MB gate | `Atlas`, `ChunkStore` |
| 5 | Colour-variant cache blowup | tab kill | **16 curated colourways, hard constraint** | `palette.ts` |
| 6 | GC pauses from per-frame allocation | sawtooth frame graph | SoA everywhere, scratch pools, out-params, **no array/object literals or closures inside any `for` loop in `fixedUpdate`** | all systems |
| 7 | `shadowBlur` / `filter` | 10–50× render cost on Safari | banned by AST lint over `src/game/art/**`; `shadowBlob` sprite | lint |
| 8 | `fillText` | 0.3–1 ms per unique string, font drift | **banned**; procedural digit paths | `DigitRenderer` |
| 9 | A* storm on district load | 40 ms hitch | expansion budget per step | `PathRequestSystem` |
| 10 | Chunk bake hitch | 40–80 ms freeze | 1 tile/frame, 3 ms abort, placeholder | `ChunkStreamSystem` |
| 11 | WebAudio node churn on horn mashing | crackle then silence | 16-voice cap + cooldown + priority stealing | `VoiceManager` |
| 12 | localStorage synchronous writes | 5–20 ms hitch mid-drive | 500 ms debounce, sync only on `pagehide` | `SaveManager` |
| 13 | Candy Trail stroked per frame | mobile Safari pathology | rasterized once per ride into the tile; animate a UV offset only; ≤24 chevrons, viewport-culled | `HintLadderSystem` |
| 14 | Full-screen `multiply` grade | 7 M px of blending | one rect, world layer only, renderScale resolution, `screen` pass deleted | `grade.ts` |
| 15 | `Path2D` cache leak from float params | unbounded growth, GC churn | quantize params (lengths 2 px, radii 1 px, angles 3°), **512-entry LRU**, dev-assert miss rate > 2% over 300 frames | `paths.ts` |
| 16 | High-DPR external monitor | desktop-only slowdown | `MAX_BACKING_PIXELS` clamp applied before the scale clamp | `Surface` |

**House style for hot loops** (the rule an AI-authored codebase violates by default): index-based `for` loops — not `for…of` on non-arrays, not `.forEach`, not `.map`/`.filter` — out-parameters for vector math, preallocated scratch arrays reused across frames.

### 14.7 Acceptance criteria

**Performance (measurable):**
> p99 frame time ≤ 16.6 ms and p99.9 ≤ 24 ms, at renderScale 1.5 on a 2019/2020 iPad and at tier 2 on the reference Chromebook, measured over a **5-minute scripted drive** (a recorded input tape, so it is repeatable) with 12 AI vehicles, 24 characters, rain on, night on, and a coin burst firing every 8 s.

**Art (the eight tests, all of which ship as `#gallery` checklist items):**
1. **24-pixel test.** Any object at 24 px as a pure black silhouette — a stranger can name it.
2. **Still-frame test.** Pause at random: the frame looks like a deliberate illustration. No object without a shadow, no object without an outline, **≤ 3 values in the body plus one outline ink and one face ink**, no pure black or white fill.
3. **30-second stillness test.** §11.7.
4. **Reaction latency test.** Visual ≤ 33 ms (hard fail 50 ms); audio ≤ 100 ms (hard fail 150 ms). Measured by instrumenting `pointerdown` vs. the rAF timestamp of the first changed frame.
5. **Repetition test.** Pan the full city: no two adjacent buildings share a silhouette *and* a colour; no two visible passengers are identical (16-slot bitmask).
6. **Greyscale test.** Every gameplay-critical distinction (route matching, pickup vs. dropoff, locked vs. affordable) is still readable.
7. **60 fps test.** As above.
8. **The 6-year-old test.** If they press the horn more than five times in the first minute, drive in circles to watch the skid marks, or chase a cloud shadow — the juice is working. If they ask *"what does it say?"*, something depends on text and must be redesigned.

**Playtest acceptance (8–10 children aged 5–7, no adult instruction permitted):**

| # | Criterion | Target |
|---|---|---|
| 1 | Time from app open to first deliberate steering input | median ≤ 8 s, p90 ≤ 20 s |
| 2 | First successful dropoff, unaided | ≥ 8/10 within 90 s |
| 3 | Children who ask an adult "what do I do?" in the first 3 min | ≤ 1/10 |
| 4 | Time-since-last-reward, p95, over a 10 min session | ≤ 8 s |
| 5 | First upgrade purchased, unaided | ≥ 8/10 within 3 min |
| 6 | First vehicle purchased, unaided | ≥ 7/10 within 15 min |
| 7 | Observed frustration events (sigh, hand-off, complaint, screen-push) | ≤ 1 per 10 min |
| 8 | Children who match a destination by shape/colour without being told | ≥ 9/10 by the third fare |
| 9 | Children who voluntarily use the Goodnight button when asked to stop | ≥ 6/10 |
| 10 | **Children showing distress at session end** | **≤ 1/10** |

Criterion 10 replaces the original week-long "unprompted return on ≥4 of 7 days", which required a longitudinal study with 10 families and sat awkwardly beside the product's explicit anti-engagement stance. It is measurable in one sitting and it measures the thing we actually care about.

---

## 15. Content data model

All balance lives in `src/content/*.ts` (typed). **No number in this document may appear in engine code.** Everything is declarative and JSON-serialisable: **no functions in data** — `(level: number) => number` cannot be schema-validated at boot, which contradicts the whole point.

```ts
type Brand<T, B> = T & { readonly __brand: B };
export type VehicleId   = Brand<string,'VehicleId'>;
export type UpgradeId   = Brand<string,'UpgradeId'>;   // 'speed' | 'money' | 'seats'
export type DistrictId  = Brand<string,'DistrictId'>;
export type PassengerId = Brand<string,'PassengerId'>;
export type CastId      = Brand<string,'CastId'>;
export type StickerId   = Brand<string,'StickerId'>;
export type CosmeticId  = Brand<string,'CosmeticId'>;
export type SfxId       = Brand<string,'SfxId'>;
export type SpriteHandle= Brand<number,'SpriteHandle'>;

/** Every gate in the game uses this one shape. Stars never appear on vehicles (§8.8). */
export interface Requirement {
  coins?: number;
  stars?: number;
  stickers?: number;
  vehiclesOwned?: number;
  requiresVehicle?: VehicleId[];
  requiresDistrict?: DistrictId[];
}

export type Locomotion = 'road' | 'offroad' | 'rail' | 'water' | 'air' | 'space' | 'float';
// v1 IMPLEMENTS ONLY 'road' and 'offroad'. The others exist in the type so post-v1
// content can be authored and balance-validated before the movement models exist.

export interface VehicleDef {
  id: VehicleId;
  tier: number;
  emoji: string;                          // roster icon only, never child-facing UI

  // --- simulation ---
  seats: number;
  topSpeed: number;                       // m/s
  accel: number;                          // m/s^2
  yawRate: number;                        // deg/s, HARD-CLAMPED to 110 by the driver
  grip: number;                           // 0..1
  locomotion: Locomotion[];
  seatUpgradeCap: number;                 // ceil(seats/3), hard max 4
  passiveIncome?: { coinsPerSec: number; requiresMovingAbove: number }; // ice-cream van

  // --- economy ---
  fareMult: number;
  routeEfficiencyHint: number;            // validator-only; CI fails if measured differs >20%
  dwellPickup: number;                    // seconds, capped at 1.5, interruptible
  dwellDropoff: number;
  distanceBand: 'A'|'B'|'C'|'D';

  // --- content shaping ---
  passengerMix: Array<{ type: PassengerId; weight: number }>;
  /** EXPLICIT triangular (min, MODE, max). mean !== mode. */
  groupSize: { a: number; c: number; b: number };
  summonRadiusBonus?: number;

  // --- unlock: COINS ONLY on the vehicle ladder ---
  unlock: { coins: number };

  // --- procedural art recipe ---
  art: {
    profile: 'bubble'|'trike'|'boxvan'|'minivan'|'long'|'monster'|'bus';
    lengthM: number; widthM: number;
    /** COSMETIC length. Collision footprint is ALWAYS the shared base footprint. */
    renderLengthM: number;
    articulated: boolean;                 // rendered follow-segment, no collision volume
    palette: { body: string; trim: string; glass: string; accent: string };
    wheels: { count: number; radiusM: number; offsets: [number, number][] };
    features: Array<'eyes'|'sliding-door'|'stop-arm'|'cone-on-roof'|'window-heads'>;
    /** Full normalized transform, authored once per (vehicle, slot). NOT a 2D point. */
    cosmeticSlots: Record<CosmeticKind, { pos: [number, number]; scale: number; rot: number }>;
    tiltMaxDeg: number;
    windowSeats: [number, number][];      // head-sprite anchors, max 6 drawn + "+n"
  };

  audio: {
    engine: 'putt'|'hum'|'rumble'|'diesel';
    basePitch: number;
    hornIndex: number;                    // index into HORN_F
  };

  perks?: Array<'shortcuts'|'jingle'>;
}

export type UpgradeStat = 'speed' | 'money' | 'seats';
export interface UpgradeTrackDef {
  id: UpgradeId;
  emoji: string;
  scope: 'account';                       // deliberately the only value
  maxLevel: number;
  /** ALWAYS a table. Formulas generate tables OFFLINE, never at runtime. */
  cost: { kind: 'table'; costs: number[] };
  effect:
    | { stat:'speed'; perLevelSpeed: 0.04; perLevelAssist: 0.05 }
    | { stat:'money'; perLevelFare: 0.07 }
    | { stat:'seats'; perLevel: 1; requiresVehiclesOwned: { kind:'linear'; m:1; b:1 } };
  unlock: Requirement;
}

export interface PassengerTypeDef {
  id: PassengerId;
  castPool: CastId[];                     // which of the 16 cast members can play this role
  fareMult: number;
  boardTimeMult: number;
  /** NO weightClass. NO accel penalty. A full bus never drives worse than an empty one. */
  behaviour: Array<'runs-to-vehicle'|'rides-roof'|'confetti-on-drop'|'escapes-at-dropoff'>;
  tierBadge: 'normal' | 'special';        // ALWAYS displayed before pickup (no reveal)
  unlock: Requirement;
  spawnWeightByDistrict: Partial<Record<DistrictId, number>>;
}

export interface CastDef {
  id: CastId;
  silhouette: 'tall'|'round'|'tiny'|'eared'|'hatted'|'longcoat';
  signatureColor: string;
  accessory: string;
  headSheet: SpriteHandle;                // 4 expressions, baked
  voice: { baseHz: number; formantHz: number; blips: 2|3|4 };
}

export interface DistrictDef {
  id: DistrictId;
  seedSalt: number;                       // hash(worldSeed, seedSalt) → identical every launch
  template: 'grid' | 'coast';
  fareMult: number;                       // Downtown 1.00, Beach 1.05
  surfaces: Locomotion[];
  stopCount: 24;
  bandsAvailable: Array<'A'|'B'|'C'|'D'>;
  palette: { skyTop:string; skyBottom:string; ground:string; groundShade:string;
             road:string; kerb:string; dash:string; water:string;
             buildingFamilies: number[] };
  musicKey: { root: string; mode: 'major'|'lydian'; bpm: number; progressions: number[][] };
  weatherAllowed: WeatherId[];
  passengerMixOverride?: Array<{ type: PassengerId; weight: number }>;
  unlock: Requirement;                    // stars only
}

export interface MissionDef {
  id: string;
  icons: string[];                        // a picture sentence; zero prose
  goal: { metric: MetricId;
          amount: { kind:'flat'; n:number } | { kind:'byTier'; values:number[] } };
  rewardStars: 1;
  eligibleFromTier: number;
  repeatable: boolean;
}

export interface StickerDef {
  id: StickerId;
  shape: SpriteHandle;
  trigger: { kind:'metric'; metric: MetricId; amount: number }
         | { kind:'event';  event: EventId };
  bookPage: number; bookSlot: number;
}

export type CosmeticKind = 'paint'|'hat'|'wheels'|'trail'|'horn';
export interface CosmeticDef {
  id: CosmeticId;
  kind: CosmeticKind;
  cost: number;                           // flat: 10/25/20/40/30
  scope: 'per-vehicle' | 'account';       // paint/hat/wheels per-vehicle; trail/horn account
  render: Record<string, number|string>;  // procedural draw params
  unlock: Requirement;
}

/** Every audio cue REQUIRES a paired visual. A test asserts every SfxId appears
 *  in at least one CueDef with a non-empty fx. §6.8 */
export interface CueDef {
  id: string;
  sfx: SfxId;
  fx: string;                             // an emitter/juice name — MANDATORY, never ''
  priority: 0 | 1 | 2;                    // 2 = never voice-stolen (Tier 3/4)
  cooldownMs: number;
  pitchVarianceSemitones: number;
}

export interface DelightTierDef {
  tier: 1|2|3|4|5;
  totalMs: number;
  skippableAfterMs: number;               // 300 for tiers 4-5; tiers 1-3 never block
  events: Array<{ atMs: number; kind: 'sfx'|'emit'|'camera'|'haptic'|'ui'; name: string;
                  args?: Record<string, number|string> }>;
}

export interface EconomyConfig {
  baseFare: 2; distRate: 1.5; blockMetres: 44;
  carpoolExp: 0.85; starStep: 0.05; maxHappyStars: 3;
  expectedTipMult: 1.10; rushCoinMult: 1.00;
  dayLengthDeliveries: 8; firstPaycheck: 4;
  validator: {
    tierIncomeRatioMin: 1.25; tierIncomeRatioMax: 1.55;
    maxMinutesPerTier: 14; minMinutesPerTier: 4;
    maxDisplayedWallet: 999;
    oversizeProbTolerance: 0.05;
    routeEffTolerance: 0.20;
    cheapestPurchasableMax: 10;
  };
}
```

---

## 16. Build & deployment

### 16.1 Vite config

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  // MANDATORY for GitHub Pages. Omitting it 404s every asset — the single most
  // common Pages failure. Repo-name-relative, never absolute.
  base: '/transport-sim-game/',
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'a/[name].[hash].js',
        chunkFileNames: 'a/[name].[hash].js',
        assetFileNames:  'a/[name].[hash][extname]',
        manualChunks: { devtools: ['src/dev/tools.ts'] },   // loaded only on #dev
      },
    },
  },
  define: {
    __DEV_TOOLS__: JSON.stringify(mode !== 'production'),
    __BUILD_ID__:  JSON.stringify(`${Date.now().toString(36)}`),
  },
  esbuild: { legalComments: 'none' },
}));
```

**`src/env.ts` is the only module that touches the raw defines:**

```ts
export const DEV_TOOLS = (globalThis as any).__DEV_TOOLS__ ?? false;
export const BUILD_ID  = (globalThis as any).__BUILD_ID__  ?? 'dev';
```

Without this, `runHeadless` under `tsx` throws at module load on undefined identifiers.

**Bundle budget, enforced in CI:** ≤ **250 KB gzip JS**. Time-to-interactive < 2.5 s on a throttled 4G Chromebook.

### 16.2 PWA

`public/manifest.webmanifest`:
```json
{
  "name": "Happy Wheels Transit Co.",
  "short_name": "Happy Wheels",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "landscape",
  "background_color": "#7FD3F7",
  "theme_color": "#FFC53D",
  "icons": [
    { "src": "./icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "./icons/512-maskable.png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

Plus `<link rel="apple-touch-icon">`. Icons are **generated at build time** by running the procedural vehicle draw code headlessly — no hand-authored art files.

`display: standalone` does three jobs at once: it exempts the save from iOS ITP's 7-day eviction, it gives fullscreen for free, and it removes Safari's edge-swipe-back gesture that would otherwise navigate away mid-drive.

### 16.3 Service worker (the part that can brick a tablet)

A stale SW serving an old `index.html` against new hashed assets is a **permanent white screen with no way for a parent to fix it**. Rules:

```js
// public/sw.js  (BUILD_ID injected at build)
const CACHE = `hw-${BUILD_ID}`;
self.addEventListener('install',  e => { self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE))); });
self.addEventListener('activate', e => { e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate' || url.pathname.endsWith('index.html')) {
    // NETWORK-FIRST for the document, cache as fallback.
    e.respondWith(fetch(e.request).then(r => { cachePut(CACHE, e.request, r.clone()); return r; })
                  .catch(() => caches.match(e.request)));
  } else {
    // CACHE-FIRST for hashed assets. They are immutable by construction.
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
```

Registered with a **relative scope** (`navigator.serviceWorker.register('./sw.js', { scope: './' })`) — an absolute scope fails under `/<repo>/`.

**`#reset` is the parent's recovery path**: unregister the SW, delete all caches, reload. Documented in the parent area.

Total cached payload < 2 MB (there are no art or audio assets to cache).

### 16.4 Balance tooling — `npm run sim` and `npm run balance`

The economy is **testable before it is playable**. This is the highest-leverage tool in the project.

```ts
// src/dev/headless.ts
export interface HeadlessOpts {
  seed: number;
  minutes: number;                 // 10 sim-minutes = 36,000 steps ≈ 1.5 s wall clock
  policy: DriverPolicy;
  district: DistrictId;
  startProfile?: Partial<PlayerProfile>;
  sample?: (step: number, snap: SimSnapshot) => void;
}
export interface SimReport {
  seed: number; steps: number;
  ridesCompleted: number; coinsEarned: number; coinsPerMinute: number;
  averageRideSeconds: number; measuredRouteEff: number; timeIdleFraction: number;
  offRoadFraction: number; meanHeadingErrorDeg: number;
  vehiclesAffordableAt: Partial<Record<VehicleId, number /* minutes */>>;
  firstCosmeticAtMinutes: number; longestRewardGapSeconds: number;
  digest: number;
  systemMs: Record<string, number>;
  commandCount: number; collectMs: number; sortMs: number;   // render systems DO run
}
export function runHeadless(opts: HeadlessOpts): SimReport;
```

`SystemRunner.forHeadless` drops **only** systems that touch the DOM. `RenderCollectSystem`, culling and the radix sort **do** run, against a `NullPainter` that accepts and discards the `DrawList` — those are exactly where quadratic blowups hide. Audio uses a `NullAudioEngine` implementing the full interface (never `context: null` with null-checks at every call site).

```ts
// src/dev/DriverPolicy.ts
export interface DriverPolicy {
  readonly name: string;
  decide(ctx: GameContext, self: DriverEntity, rng: Rng): Intent;
}
export const Policies = {
  /** Ceiling: pure-pursuit, perfect pathing, never off-road. Upper bound on earn rate. */
  optimal: DriverPolicy,
  /** Target: our model of a competent 6-year-old. Pure-pursuit + Gaussian steering
   *  error + 15%/s chance of a random detour input. MUST be calibrated from a real
   *  recorded tape (§17, M3) before any tuning decision is treated as final. Until
   *  then it is exported as `child_UNCALIBRATED` and every number derived from it is
   *  marked provisional. Re-measure after ANY control-scheme change. */
  child: DriverPolicy,
  /** Floor: mostly random input. If THIS still earns money, nobody gets stuck. */
  flailing: DriverPolicy,
  /** Replays a recorded InputTape. */
  tape: (t: InputTape) => DriverPolicy,
} as const;
```

`npm run sim` sweeps **30 seeds × 3 policies × 7 progression stages**, writes `measured.json`, and prints a designer-readable CSV.

**`npm run balance` runs in CI and FAILS THE BUILD if:**
- any `R(t+1)/R(t)` falls outside `[1.25, 1.55]`
- any tier's projected minutes fall outside `[4, 14]`
- `|measured routeEff − routeEfficiencyHint| > 20%` for any vehicle *(this is what makes the validator real rather than a machine for validating a fiction)*
- any `P(group > seats)` deviates from its staged target by > 0.05
- any vehicle is strictly dominated by a cheaper one on `(seats, topSpeed, fareMult, price)`
- any weather or time-of-day fare modifier is `< 1.0`
- any content id is referenced but undefined, or any `Requirement` is unreachable
- `cheapestPurchasableItem.cost > 10`
- any price or projected wallet exceeds 999
- `ambientTrafficCount ∈ [6,12]` changes `coinsPerMinute` by > 5%

**Three player-experience gates, all measured on `Policies.flailing`:**
1. A visible reward (coins, sound, number going up) at least every **45 s**.
2. First **cosmetic** unlock within **4 minutes**.
3. **Vehicle 2 within 14 minutes** (and within **8 minutes** on `Policies.child`).
4. `coins` is **non-decreasing** across the entire run under every policy — no path exists that reduces it except an explicit purchase.

The original gate ("flailing reaches vehicle 2 in 20 min") permitted a realistic 5–15 minute first session to end with zero progression. That is the retention question, and it is now gated correctly.

### 16.5 Test strategy (Vitest 3)

| Layer | What | Where |
|---|---|---|
| Pure math | Vec2/Angle ops, `lerpAngle` shortest-arc across ±π, spline arc-length vs numeric integration (<0.1%), easing monotonicity and endpoints, `Rng` reproducibility + `fork` purity + `fork` duplicate-label throw + state round-trip + first-8-outputs fixture for seed 1234 | `tests/math/` |
| ECS | component add/remove updates mask, query cache invalidation, `queryNot` correctness, `World.digest()` stability | `tests/ecs/` |
| World | A* cost equals brute-force Dijkstra on `tinyCity` for all node pairs and all masks; `nearestEdge` recall vs brute force on 500 random points; `SpatialHash.queryCircle` returns a superset of, and ≤ 3× the size of, brute force; `DistanceMatrix` symmetry and triangle inequality | `tests/world/` |
| Economy | fare monotonic in distance; upgrade cost strictly increasing; **coins can never go negative through any purchase path**; `Policies.flailing` earns > 0 over 10 minutes; the three gates in §16.4 | `tests/economy/` |
| Save | every version fixture migrates to current and validates; truncated payload falls back to backup; checksum mismatch is **detected but loads anyway**; `QuotaExceededError` falls back to memory; Save Code export→import round-trips exactly | `tests/save/` |
| **Determinism** | same-process digest equality; **save/load round-trip determinism (§13.12)**; property assertions on `SimReport` | `tests/determinism/` |
| Render (no canvas needed) | every registered `ShapeDef` draws without throwing at every zoom bucket against a `RecordingContext`; per-shape op budget; `paramsSchema` completeness | `tests/render/` |
| Audio | every `SfxId` appears in ≥ 1 `CueDef` with a non-empty `fx`; `OfflineAudioContext` renders assert duration bounds, peak ≤ 1.0 (no clipping), no DC offset | `tests/audio/` |
| Lint-as-test | no `shadowBlur`/`filter`/`clip`/non-`source-over` composite/per-frame gradient in `src/game/art/**`; no `fillText` outside `DigitRenderer`; no string literal reaching `Painter.text` outside `num()` and `src/game/ui/parent/**`; no module-scope side effects in `src/game/art/**` | `eslint.config.js` |

```ts
// tests/helpers/RecordingContext.ts — real render testing in Node, zero canvas dependency
export interface RecordedOp { op: string; args: readonly unknown[]; }
export function createRecordingContext(): {
  ctx: CanvasRenderingContext2D;   // a Proxy recording every call and property set
  ops: RecordedOp[];
  countOf(op: string): number;
};
```

`ShapeDef` carries `readonly paramsSchema: Record<string, { default: number|string; min?: number; max?: number }>` — required by both the render test (`defaultParams`) and the `#gallery` variant grid, so it pays for itself twice.

**Banned features are caught by AST lint, not by the runtime test** — a shape that sets `shadowBlur` only when `params.glow > 0` passes a default-params runtime check. The runtime op-budget test stays, because that one genuinely needs to execute.

**Explicitly not tested:** visual correctness (no screenshot diffing — `#gallery` renders every shape at every zoom bucket and colourway on a labelled grid for human or agent review); audio aesthetics; input-device integration (thin adapters, hand-tested on real devices; the `ActionMap` beneath them is unit-tested with synthetic events); frame rate (CI cannot measure an iPad — `SimReport.systemMs` catches algorithmic regressions, the reference devices validate the budget).

### 16.6 Dev tools and access gating

- **`MiniOverlay`** (~3 KB, **always in the production bundle**): fps, quality tier, build id, seed, error count, total canvas MB. Toggled by `#dev`.
- **`DebugOverlay` (full) + `DevConsole`**: a separate chunk loaded via `await import('./dev/tools')` only when `location.hash` contains `dev`. One extra HTTP request for a parent following bug-report instructions; zero bytes in the main bundle.
- Full overlay shows: 120-frame frame-time graph with a 16.7 ms line; per-system p50/p95 bars; **covered-pixel count per layer**; entity counts by archetype; `DrawList.length` and batch-run count; atlas entries/bytes/hit-rate/bakes-this-frame; tile pool state; particle counts by pool; audio voice count; A* queries/expansions; camera pos/zoom/heading; seed and `__BUILD_ID__`; discarded-time counter; **the reward-cadence graph (§11.4)**; the error ring.
- Dev console commands: `money <n>`, `give <vehicleId>`, `unlock all`, `tp <x> <y>|<stopId>`, `spawn <archetype> [n]`, `seed <n>`, `district <id>`, `timescale <n>`, `quality <tier>`, `cache stats|clear`, `save export|import|wipe`, `tape record|stop|replay`, `bake <cx> <cy>`, `timeline scrub`.
- **Timeline scrub overlay** (dev-only): `[` / `]` scrub, `\` loop, on-screen `t` in ms, Vite HMR on the timeline module. Two hours of work; saves two days of rebuild cycles tuning a 6-second set piece.
- **Access gating.** `#dev` in the URL (a parent types it) **or** the parent gate in Settings. **The four-finger-tap gesture is deleted**: kids rest palms on tablets constantly (a palm registers as multiple points) and iPadOS intercepts four- and five-finger gestures anyway, so it was simultaneously too easy to trigger accidentally and unreliable when attempted deliberately.

### 16.7 GitHub Pages workflow

```yaml
# .github/workflows/deploy.yml
name: deploy
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint            # includes the banned-feature AST rules
      - run: npm run typecheck
      - run: npm test                # vitest, includes determinism + save round-trip
      - run: npm run balance         # FAILS the build on any §16.4 violation
      - run: npm run build
      - run: npm run size            # fails if gzip JS > 250 KB
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    environment: { name: github-pages, url: "${{ steps.d.outputs.page_url }}" }
    runs-on: ubuntu-latest
    steps:
      - id: d
        uses: actions/deploy-pages@v4
```

---

## 17. Implementation plan

Sequenced so there is a playable build as early as possible, and so the two genuinely high-risk unknowns — **does the ShapeCache hit its numbers** and **does follow-my-finger work for a real 6-year-old** — are answered before anything is built on top of them.

---

### M0 — Skeleton and pipeline
**Files:** `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `index.html`, `src/boot.ts`, `src/env.ts`, `src/engine/constants.ts`, `src/engine/core/GameLoop.ts`, `src/engine/render/Surface.ts`, `.github/workflows/deploy.yml`, `public/manifest.webmanifest`.

**Done when:** a moving rectangle renders at 60 fps on a real iPad **from the deployed GitHub Pages URL** (i.e. `base` is correct), the loop implements the §13.4 sub-step and input-latching contract, `constants.ts` contains every §14.2 value with justification comments, and CI runs lint + typecheck + build + size.

---

### M1 — Render core and the art proof
**Files:** `engine/render/{Painter,Canvas2DPainter,DrawList,Layer,RenderPass,SpriteRegistry,ShapeCache,Atlas,DigitRenderer,Camera,Viewport}.ts`, `engine/diag/{Profiler,MiniOverlay,AdaptiveQuality}.ts`, `game/art/{palette,paths,index}.ts`, `game/art/shapes/vehicles/taxi.ts`, `game/art/shapes/ui/digits.ts`, `game/scenes/GalleryScene.ts`, `tests/render/*`, `tests/helpers/RecordingContext.ts`.

**Done when:**
- One taxi is drawn with the double-stamp outline, shadow, three body values and a face. **This single screenshot proves or kills the entire art direction — get it on a tablet in week one.**
- 500 cached sprites render at 60 fps on both reference devices.
- **Total canvas bytes ≤ 96 MB on the reference iPad** (hard gate).
- `#gallery` renders every registered shape at every zoom bucket and colourway.
- `MiniOverlay` and `AdaptiveQuality` exist and are on-screen — **quality tiering is phase 1, not phase 12.** Every subsequent milestone ends with a "60 fps on the worst device" checkpoint. Retrofitting tiering into finished draw code, and concentrating all perf risk after the schedule is spent, is how this project fails.

> **Escape hatch.** If `ShapeCache` misses the §14.3 numbers here, revisit the renderer now — before 15,000 lines of game code exist on top of it.

---

### M2 — ECS, input, and a car on a green field
**Files:** `engine/ecs/*`, `engine/core/{SystemRunner,Scheduler,EventBus,Scene}.ts`, `engine/input/*`, `engine/math/{Vec2,Angle,ease,Rng,Spring}.ts`, `game/components/*`, `game/systems/{PlayerControlSystem,DrivingSystem,CameraSystem,SnapshotSystem,RenderCollectSystem,order}.ts`, `content/tuning.ts`.

**Done when:** the same car is drivable by touch, mouse, keyboard and gamepad through the single `Intent` abstraction; the heading-up camera with the ±15° body clamp and the 200°/s error-driven cap is implemented; park, coast and the movement-based pointer-ownership rules all work; Gentle Mode's world-up + screen-absolute variant works; camera angle is interpolated by shortest arc.

---

### M2.5 — **TOY TEST** (the most important gate in the plan)
**Files:** a hidden gesture that hot-swaps `follow-finger` / `virtual-stick` / `tap-target` at the `ActionMap` level; `dev/tape.ts` recording.

**Do this:** a 20-minute session with a real 6-year-old, on the car-on-an-empty-green-field build. **If the car alone is not fun to steer around an empty field, no amount of city will fix it.**

**Done when:** one scheme is usable without adult help within 60 s. **Record an input tape at this session** and use it to calibrate `Policies.child` (metres-per-minute, mean heading error, idle fraction, off-road fraction). Until this tape exists, every economy number derived from `routeEff` is provisional.

The control scheme determines the camera, the road width, the assist strength, the turn rate and the economy's metres-per-minute. Discovering at M6 that it doesn't work would invalidate M3 and M5.

---

### M3 — The world
**Files:** `game/world/{RoadGraph,DistrictGen,DistrictLoader,Pathfinder,ChunkStore,ChunkBaker,SpatialHash,DistanceMatrix}.ts`, `game/art/shapes/city/*`, `content/districts/downtown.ts`, `game/systems/{RoadAssistSystem,JunctionAssistSystem,CollisionSystem,ChunkStreamSystem}.ts`, the district linter.

**Done when:** a full-screen procedurally generated Downtown runs at 60 fps on both reference devices; the map is byte-identical across launches for a given `worldSeed`; road dashes are continuous along chains and trimmed at junctions; dead ends have no protruding stubs; road assist and junction assist feel forgiving to the M2.5 child; the ≤120-edges-per-chunk linter passes; tile-pool bytes are within budget.

---

### M4 — Save, settings, profiles *(moved forward from M7 — deliberately)*
**Files:** `engine/save/{SaveManager,SettingsStore,Migrations,SaveCode}.ts`, `game/save/SaveSchema.ts`, `game/scenes/ProfileScene.ts`, `engine/platform/{Lifecycle,ParentGate}.ts`, `tests/save/*`, `tests/determinism/saveRoundTrip.test.ts`.

**Done when:** three profiles selectable by car silhouette + colour; save/load round-trip determinism passes; quota-exceeded falls back to memory with a parent-visible flag; checksum mismatch loads-anyway-with-backup; Save Code exports and imports; the parent gate (3 s hold + `4 × 7`) works.

**Why here:** without persistence, no playtest can answer the session-to-session question, which is the retention question. Every playtest from M6 onward is worth more with saves.

---

### M5 — Core loop and economy
**Files:** `game/systems/{SpawnSystem,PickupSystem,DropoffSystem,EconomySystem,ProgressionSystem}.ts`, `game/art/shapes/chars/*`, `content/{economy,vehicles,upgrades,passengers,cast,missions,stickers}.ts`, `game/ui/Hud.ts`, `dev/{headless,DriverPolicy,balance}.ts`.

**Done when:** passengers spawn under all §9.3 constraints, groups board and leftovers cheer, dropoff pays, `npm run sim` produces a sane `SimReport`, `npm run balance` runs green in CI, and the reward-cadence overlay shows Tier-1 gaps under 8 s.

**Build the leftover-passengers-cheering behaviour first within this milestone.** It is the entire "buy a bigger vehicle" argument delivered wordlessly, and everything else in the economy leans on it.

---

### M6 — Feel: audio, particles, juice, HUD
**Files:** `engine/audio/*`, `engine/fx/{Particles,Emitter,Tween,Timeline,Juice}.ts`, `content/{sfx,emitters,delight}.ts`, `game/ui/widgets/*`, `game/art/grade.ts`.

**Done when:** the full Delight Stack table drives every reward; the coin-chain semitone ladder works; the horn does all of §11.5; two particle pools with the 60-particle essential reserve; the grade pass is one `multiply` rect over the world layer only, ungraded gameplay layers on top; every `SfxId` has a paired visual.

**Playtest with an actual six-year-old at the end of this milestone.**

---

### M7 — Shop, garage, progression, second vehicle
**Files:** `game/ui/{ShopScreen,GarageScreen,DayReport,PauseScreen}.ts`, `content/cosmetics.ts`, `game/art/shapes/vehicles/{tuktuk,icecream}.ts`, `game/systems/{HintLadderSystem,CompetenceSystem}.ts`.

**Done when:** the affordability ring, before/after pips, hold-to-buy and the picture confirm all work; the Day Report and the "finish day now" button work; the hint ladder L0–L5 runs with soft autopilot; adaptive assist triggers; the three §16.4 player-experience gates pass under `Policies.flailing`.

---

### M8 — Content fill
**Files:** remaining `game/art/shapes/vehicles/*` (van, limo, monster, schoolbus), `content/districts/beach.ts`, the 16 cast members, the ~40 stickers, the ~24 missions, the cosmetic catalogue, `Timeline` set pieces.

**Done when:** all 7 vehicles, both districts, day/night, rain, the sticker book, the gift box, the weekly rotation, and the CITY LIGHT-UP set piece (with its three shorter variants) all ship. Every acceptance test in §14.7 passes.

---

### M9 — Hardening and ship
**Files:** `public/sw.js`, `engine/platform/ServiceWorkerClient.ts`, `engine/diag/ErrorRing.ts`, `game/ui/OopsScene.ts`, `game/ui/parent/ParentScreen.ts`, migration fixtures.

**Done when:** the service worker with `#reset` recovery is verified by deliberately shipping a stale build over a fresh one; the OopsScene triggers correctly on a forced throw; Gentle Mode, Always Daytime and Cruise Mode all work; the full playtest battery (§14.7) runs with 8–10 children; p99 frame time meets budget over the 5-minute scripted drive on both reference devices; **≤ 1/10 children show distress at session end.**

---

## 18. Post-v1 backlog

Ordered by architectural readiness. Everything here has a data stub, a type-system slot, or an explicitly-preserved parameter in v1, so none of it requires a refactor.

**Vehicle ladder tiers 8–12** — Tram (`rail`), Ferry (`water`), Plane (`air`), Rocket Bus (`space`), Balloon (`float`). All five `Locomotion` values already exist in the type union and are already balance-validated; only the movement models are missing. Preconditions that must be honoured when they ship:
- *Tram:* one closed loop per district, single direction, destinations sampled **only from stops on the loop**, junctions auto-select toward the target with a flashing arrow 2 s ahead. Rails add a 1.4× path-length penalty, which is what stops it breaking the curve. It is the vehicle a tired child (or a 4-year-old sibling) will choose — the single most valuable accessibility unlock in the roadmap. Its idea already ships in v1 as **Cruise Mode**.
- *Plane:* **no landing skill.** Fly over the destination pad → a 2 s scripted auto-descent triggers. Map edges are soft-bounded by a wind push, never a wall or a reset.
- *Balloon:* bought with **30 stickers**, zero collision, `fareMult 3.0`. It exists so that "I'm tired but I still want to play" has an answer. Nobody else designs for that need.

**Districts 3–6** — Farm & Zoo, Harbour, Sky Islands, Moon. `DistrictDef` and the seeded generator already support new templates; `NavMask` on edges already supports water and rail channels without a second graph.

**Extra Riders** — up to 2 solo passengers mid-route with their own destinations. Requires: the job card growing to 380 px (2 jobs) / 480 px (3 jobs), **a hard cap of 3 concurrent visible jobs regardless of seat count**, seats above 3 granting passengers who *share* an existing destination (stacked portrait + count pip), and every wayfinding identity encoded as **colour + shape** on both the hat and the beacon. Deferred because it puts a multi-stop routing problem in front of a child who has owned one vehicle for four minutes.

**The Depot** — a decorable company yard, ~24 items, the vehicles parked in it, the stickers on the wall. A display case is the strongest long-tail motivator for this age. It is the correct endgame coin sink once the ladder extends past the bus and the wallet needs somewhere to go. It must not reintroduce 5-digit prices; scale it to the v1 economy.

**Golden Route contracts** — 3/day, gold shine, `d = 8–12 blocks`, higher pay. Requires the payout formula to gain a second term, so it must ship with a re-run of the validator and an updated single formula (never stacking multipliers).

**Split-screen two-player** — ~93 lines across 6 files plus one new `PlayerSelectScene`, because `ctx.players` is an array, UI is viewport-relative, and `RenderPass` carries its own camera from day one. One additional requirement when it ships: **latch pointer→player assignment at `pointerdown` for the lifetime of the pointer**, or a child dragging across the split line hijacks the other player's car mid-drag.

**Verticality (helicopter, ramps, jumps, drone drops)** — ~2 new files and ~9 lines of edits, because `Transform.z`/`pz`, `LayerId.Air` and the `Flight` component slot exist from day one and `DrivingSystem`/`RoadAssistSystem` already `queryNot([...], ['flight'])`.

**Minimap** — only ever as a *collectible toy* ("the map the duck gives you"), never as required navigation, and never before the child is ~8.

**Races** — only under the rule that **everyone finishes and everyone gets a prize**, first place just gets a bigger one, and the race ends when the *player* finishes rather than when a timer does.

**Rainbow Rush coin bonus** — deliberately withheld in v1 (§8.3). If it ever returns, `rushDutyCycle` must become a first-class term in the validator's income model, not a correction applied afterwards.

**Web audio spatialisation / reverb** — deferred indefinitely. The 3-tap delay is the shipping answer; a `ConvolverNode` costs 5–12% of a Chromebook core for an effect nobody will notice at this art level.

**WebGL `Painter` backend** — the abstraction is already WebGL-expressible (no `clip`, no per-entity composite, all state changes hoisted). Only worth doing if a future feature (real lighting, thousands of agents, particle counts an order of magnitude higher) demands it. Canvas2D with baked atlases is not the bottleneck at v1 scale.

**Localisation** — currently a non-issue, because the child-facing product contains zero words. If the parent surface ever needs translating, it is ≤ 24 strings in one module.