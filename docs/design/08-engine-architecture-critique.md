# Adversarial review — Engine & code architecture

## A. Platform reality: the two hosts that will actually break this

**A1. `localStorage` on iOS Safari is deleted after 7 days.** WebKit's ITP purges all script-writable storage (localStorage *and* IndexedDB) after 7 days of Safari use without user interaction on the origin. A child who plays on Saturdays loses every vehicle, every upgrade, every session. The spec treats save as a solved problem (§7.4 tests migrations, §8.2 budgets 0.5 ms for the write) and never mentions the one thing that will actually destroy saves.
**Fix:** ship a `manifest.webmanifest` (`display: standalone`, `orientation: landscape`) from day one, and make "Add to Home Screen" a first-run parent instruction — home-screen web apps are exempt from the 7-day cap and also get fullscreen for free. Additionally: a parent-facing **Save Code** export/import in settings (base64 of the save JSON, ~1.5 KB, shown as selectable text plus a copy button) — not a dev-console command as §7.5 has it. Add a `lastSeen` timestamp and, on a save that is >6 days old, silently re-write it to refresh the eviction clock.

**A2. iOS Safari canvas memory limit — the "everything goes blank white" bug.** The design creates one baked bitmap per shape per zoom bucket per colourway, plus N chunk tiles. WebKit enforces a per-tab total canvas backing-store ceiling; past it, previously-drawn canvases are silently discarded and draw as transparent. Hotspot #5 anticipates a "tab crash" but the failure mode is worse and quieter than a crash. A 20 MB LRU on *ShapeCache entries* does not bound total canvas pixels, because `ChunkStore` tiles are budgeted separately and never numerically.
**Fix:** never allocate one canvas per baked shape. Bake into **shelf-packed atlases** of fixed size (2048×2048, RGBA = 16 MB each), cap at 3 atlases (48 MB) on iOS / 6 on desktop, and evict by *atlas*, not by entry (with a compaction pass at scene transitions). Chunk tiles get their own hard pool: N tiles of exactly 512×512×renderScale², preallocated once at boot and recycled — never allocated per chunk. Count and display total canvas bytes in the overlay, and fail the M1 gate if it exceeds 96 MB on the reference iPad. Also state explicitly whether bakes use `OffscreenCanvas` (2D context: Safari 16.4+, so available on an A12 iPad running iPadOS 17, but you must feature-detect and fall back to a detached `<canvas>`).

**A3. GitHub Pages specifics are entirely absent.** Three things bite:
- Vite `base` must be `'/<repo>/'` or every asset 404s. This is the single most common Pages failure and it is not in §10 or §12/M0.
- **You cannot set response headers on Pages.** No COOP/COEP → no cross-origin isolation → no `SharedArrayBuffer`. Record this as a permanent constraint so nobody later designs a worker-based baker around shared memory. (A worker using `postMessage` + transferable `ImageBitmap` is still fine and is the right escape hatch for chunk baking.)
- The M7 service worker on a static host is how you brick a child's tablet forever. A stale SW serving an old `index.html` against new hashed assets = permanent white screen with no way for a parent to fix it.
**Fix:** SW with `skipWaiting()` + `clients.claim()`, network-first for `index.html`, cache-first for hashed assets, cache name keyed to `__BUILD_ID__`, and delete all non-matching caches on activate. Add a `#reset` hash flag that unregisters the SW, clears caches, and reloads — that is the parent's recovery path. Add a bundle budget to M0: ≤ 250 KB gzip JS, interactive < 2.5 s on a throttled 4G Chromebook.

**A4. `DeviceInfo.probe()` returns fields that do not exist on the primary target.** `navigator.deviceMemory` is not implemented in Safari — so `budgetsFor(device)` (boot step 3, which sizes the ShapeCache) is undefined behaviour on iPad. There is also no API for `refreshRate`; it can only be measured over ~20+ rAF frames, i.e. *after* boot step 1 where §10 places it.
**Fix:** `probe()` returns `{ dpr, touch, isIOS, hardwareConcurrency, screenPx }` only. Memory tier is inferred: iOS → conservative tier by default; elsewhere `deviceMemory ?? (hardwareConcurrency >= 8 ? 8 : 4)`. Refresh rate is measured during `BootScene` (which already runs a warm-up with a progress bar) over 60 frames and applied at scene handoff — never at boot.

---

## B. Bugs in the code that is actually specified

**B1. `Surface.resize` makes tier 3 a no-op on exactly the device that needs it.** `this.renderScale = clamp(dpr * qualityScale, 1, 2)`. On a 1× DPR Celeron Chromebook, tier 3's `qualityScale: 0.6` gives `clamp(0.6, 1, 2) = 1`. Tiers 1, 2 and 3 all resolve to renderScale 1. The adaptive-quality system's most important lever is dead on the weakest reference device.
**Fix:** `clamp(dpr * qualityScale, 0.55, 2)`. Sub-1 renderScale with CSS upscaling is the standard technique and looks acceptable with smoothing on. Also: the `MAX_BACKING_PIXELS` sqrt-rescale afterwards can push renderScale below the clamp you just applied — apply the pixel cap *before* the clamp, or re-clamp after.

**B2. Input edge detection runs inside `fixedUpdate` (boot step 7), so taps are consumed 0–5 times per frame.** `ctx.input.update(dt)` is called per sub-step while `ctx.input.endFrame()` is called once in `variableUpdate`. On a frame with 3 sub-steps, a `justPressed` is true on sub-step 1 and false on 2–3 (fine) — but on a frame with **0** sub-steps (which happens whenever the accumulator hasn't filled, e.g. on a 120 Hz display) the tap is never observed at all, and `endFrame()` clears it. A dropped tap on a horn button is a "the game ignored me" moment for a 6-year-old.
**Fix:** sample devices once per frame in `variableUpdate`, before the fixed steps. Edges go into a *latched* buffer: `pressedPending` set on sample, cleared only when a fixed sub-step consumes it, with a hard expiry of 200 ms. Analogue axes are held constant across all sub-steps of a frame. Write this into the loop spec explicitly; it is the most common source of "input feels flaky" in fixed-timestep engines.

**B3. Audio unlock as specified cannot work on iOS.** §10: "it unlocks on the first real pointerdown, which is the Play button in TitleScene." If that pointerdown travels through `InputManager` → snapshot → `fixedUpdate` → UI system, you are no longer inside the user-gesture task and `AudioContext.resume()` will not unlock. Guaranteed silent game on iPad.
**Fix:** a dedicated, un-queued DOM listener installed at boot: `document.addEventListener('pointerdown', unlockOnce, { once: true, capture: true })` which synchronously constructs/resumes the context and plays a 1-sample silent buffer, *then* lets the event continue to the normal pipeline. Also re-`resume()` on every `visibilitychange → visible` (iOS suspends the context on background) and on `AudioContext.onstatechange`.

**B4. The chunk baker's own claim is false and the dashes are broken.**
- "Three state changes total ... regardless of edge count" — `ctx.lineWidth` is assigned **inside the loop** in passes 1 and 2. That is 2N state changes. *Fix:* bucket edges by width class (alley/street/avenue = 3 widths), giving 9 total sets; or drop the claim.
- `lineCap = 'round'` applies to the road and kerb strokes, so **every dead-end gets a semicircular stub protruding `width/2` past its terminal node**, which will visibly poke into buildings and off chunk borders. *Fix:* `lineCap = 'butt'` for kerb/road, `round` only for the dash pass; or shorten terminal edges by `width/2` at bake.
- Dashes are stroked per edge with no `lineDashOffset` continuity, so **dash phase restarts at every node** and dashes run straight through junction boxes. On a grid city that's a visible artefact at every intersection. *Fix:* carry accumulated arc length along each road chain into `ctx.lineDashOffset`, and trim the dash polyline at both ends by `max(incidentEdgeWidth)/2` — which requires exactly the junction knowledge §6 claims is unnecessary. It's cheap (one precomputed `trimStart/trimEnd` float per edge, baked into district data), but it must be admitted.
- No edge-count bound is given, yet the baker has a 3 ms abort. Three passes × N edges = 3N path constructions. *Fix:* hard cap 120 edges per chunk, validated by a district-data linter at build time, so the 3 ms abort is a safety net rather than the normal path.

**B5. `boot.ts` violates non-negotiable invariant I2 on its own line.** §9b: "No file outside `Surface.ts` and `Viewport.ts` may read `window.innerWidth`/`innerHeight`." §10 step 2: `surface.resize(innerWidth, innerHeight, ...)`. Trivial, but it is the first line of code anyone will copy.
**Fix:** `surface.syncToViewport(quality)` reads its own element's `getBoundingClientRect()` (also the correct source — `innerWidth` includes scrollbars and is wrong on desktop). Prefer `ResizeObserver` over `window.onresize`; on iOS, `innerHeight` changes as the URL bar collapses and will cause a resize storm mid-drive.

**B6. `no-restricted-globals` misses the member forms.** `window.setTimeout`, `globalThis.requestAnimationFrame`, and `const r = Math.random` all slip through.
**Fix:** add `no-restricted-properties` entries for `window.setTimeout/setInterval/requestAnimationFrame`, plus `no-restricted-syntax` for `MemberExpression[property.name='random']`. Also ban `Math.sin|cos|tan|atan2|pow|exp|log` in `src/game/systems/**` — see C2.

**B7. `Rng.next()` is not sfc32 as published.** The reference adds the *post*-incremented `d`; this version adds the pre-incremented `d`. It is probably still a fine generator, but "passes PractRand to 32GB" is a claim about a different function and does not transfer.
**Fix:** use the published sequence verbatim, or drop the PractRand claim and add a test asserting the first 8 outputs for seed `1234` against a checked-in fixture.

**B8. `fork(label)` — the "THE critical API" — has no specified algorithm.** Everything in §7 depends on it.
**Fix, precisely:** `fork(label)` returns `new Rng(xmur3(rootSeedString + '\u0000' + label))` — a **pure function of (root seed, label) only**, never drawn from the parent's stream. If it draws from the parent, fork *order* becomes significant and the entire "adding a particle effect doesn't move traffic" guarantee evaporates. Additionally: a `Map<string, Rng>` registry that throws on a duplicate label (two forks of the same label produce identical, correlated streams — a silent, nasty bug), and `fork()` is forbidden after `BootScene` completes (assert in dev). Finally, `getState/setState` must be **persisted per named stream in the save file** — otherwise loading a save replays the same traffic and request sequence every session, which a 6-year-old *will* notice as "the same people every time."

---

## C. Determinism is over-scoped, and the part that's load-bearing is impossible

**C1. Cross-build digest equality will flake and then be disabled.** `expect(a.digest).toBe(GOLDEN.digest)` compares a hash of positions after 3600 steps across builds. `Math.sin/cos/atan2/exp/log/pow` are **not required by ECMAScript to be correctly rounded**; V8's implementations differ between versions and between x86 and arm64. A driving sim integrates heading through `cos`/`sin` every step. A 1-ULP divergence at step 5 is amplified chaotically; by step 3600 the car is metres away. Quantising to 1/64 unit does not save you — it absorbs *last-bit* noise, not *chaotic amplification*. The test will pass on the author's Mac and fail on CI, someone will add `--update-golden` to CI, and it becomes the rubber stamp §7.4 explicitly warns about.
**Fix, pick one:**
- (Recommended, ~zero cost) **Drop cross-build digest equality.** Keep `expect(a.digest).toBe(b.digest)` (same-process — catches real nondeterminism: `Math.random`, `Date.now`, Set iteration, uninitialised memory — and *never needs regenerating*). Replace the fixture comparison with **property assertions** on `SimReport`: `moneyEarned > 0`, `ridesCompleted` within `[lo, hi]`, `timeIdleFraction < 0.5`, digest stable across a save/load boundary (see C3). These catch behavioural regressions without pinning bit patterns.
- (If you truly want cross-build) ban transcendentals in sim code and route all of them through `src/engine/math/exact.ts` — LUT-based `sin`/`cos` with 4096-entry tables and linear interpolation (bit-exact by construction), `atan2` via a rational approximation. Costs ~80 lines and is measurably *faster* than `Math.sin`. But this is only worth it if something depends on it, and nothing here does.

**C2. What is determinism actually buying?** Single-player, no server, no netcode, no replay feature, no leaderboard. The honest answer is: (a) reproducible bug repro from a seed in a URL, (b) the headless economy sweep, (c) freedom from wall-clock timers (so a slept tablet resumes correctly). All three are real and worth having. None of them require cross-build bit-exactness or a golden fixture. Scope the determinism story to those three deliverables and delete the rest; §7.2's four hand-enforced rules plus lint are enough.

**C3. The one determinism test that matters is missing.** Nothing tests **save/load round-trip determinism**. This is where real bugs live: an unsaved RNG stream, a transient component not serialised, a spawn timer reset.
**Fix:** `it('save/load is transparent')` — run 1800 steps, serialise, construct a *fresh* `GameContext` from the payload, run 1800 more; digest must equal an uninterrupted 3600-step run. Same-process, so C1's float problem doesn't apply. This single test is worth more than the whole golden fixture.

**C4. `runHeadless` will not run under `tsx` as specified.** `__DEV_TOOLS__` and `__BUILD_ID__` are Vite `define` constants; under `tsx` they are undefined identifiers and the import graph throws at module load. Also `ALL_SHAPES` modules may touch `document` at module scope.
**Fix:** a single `src/env.ts` exporting `export const DEV_TOOLS = (globalThis as any).__DEV_TOOLS__ ?? false;` — nothing else references the raw constants. Add a `tests/setup.ts` that defines them. And a lint rule: no module-scope side effects in `src/game/art/**` (shape registration is a function call from `registerAllShapes`, never top-level).

**C5. `defaultParams(def)` is used but never defined.** The render test cannot exist without it.
**Fix:** `ShapeDef` gains `readonly paramsSchema: Record<string, {default: number|string, min?, max?}>` — which the `#gallery` scene also needs to render its variant grid, so it pays for itself twice.

**C6. The banned-feature render test is weaker than the lint rule it should be.** A shape that sets `shadowBlur` only when `params.glow > 0` passes the runtime test with default params.
**Fix:** move the ban to AST lint over `src/game/art/**` (`no-restricted-properties` on `shadowBlur`, `filter`, `clip`, `globalCompositeOperation`, `createLinearGradient` outside a `bake` function). Keep the runtime op-budget test — that one genuinely needs to run the code.

---

## D. The performance budget is asserted, not derived

**D1. There is no fill-rate row, and fill rate — not draw-call count — is what kills Canvas2D on an A12.** The table budgets 5.5 ms for "~700 `drawImage` + 9 chunk tiles + UI" without ever stating a pixel count. On an iPad 8 at renderScale 2, the backing store is 2160×1620 = 3.5 Mpx. Nine full chunk tiles plus 700 sprites plus HUD, at typical overdraw, is 8–12 Mpx of textured fill per frame. Every one of those `drawImage` calls has a non-integer affine transform with `imageSmoothingEnabled = true`, i.e. bilinear sampling. 5.5 ms is optimistic by roughly 2×.
**Fix:** add an explicit **fill budget: total covered backing-store pixels ≤ 3.0 × backing-store size per frame**, instrumented in the overlay by summing `sx*sy*bitmapArea` at flush time. Cap `renderScale` at **1.5 on iOS** rather than 2 (at this art scale the difference is invisible and it saves 44% of fill). Size chunk tiles so the visible ring covers ≤ 1.4× the viewport, not 9 tiles of unspecified size.

**D2. Every geometric number the budget depends on is missing.** Not specified anywhere: chunk size in world units, tile resolution in px, `ZOOM_BUCKETS` values, world-units-per-pixel at zoom 1, `MAX_BACKING_PIXELS`, `FIXED_DT`, `SHADOW_ALT_FALLOFF`, `ALT_TO_SCREEN`, the A* expansion budget, the ShapeCache bitmap size cap vs. the 20 MB LRU vs. the tile pool. An engineer cannot build §8 from §8.
**Fix:** one `src/engine/constants.ts` with every one of these as a named export and a one-line justification comment, referenced by number from the budget table. Suggested starting values: 1 world unit = 1 m; camera zoom 1 = 24 px/m; chunk = 48 m; tile = 1152×1152 backing px at zoom 1 (covers a chunk at 24 px/m); ring 3×3; `MAX_BACKING_PIXELS = 4_500_000`.

**D3. §8.1's target scene and §8.3's tier 0 contradict each other.** Budget assumes 200 particles; tier 0 permits 800. If the game ever reaches its own tier-0 allowance the budget is blown by ~1.5 ms of particle draw and AdaptiveQuality immediately demotes — meaning **tier 0 is unreachable in practice and the "best" tier is dead code.**
**Fix:** tier 0 particle budget = 250, tier 1 = 180, tier 2 = 120, tier 3 = 70. Re-derive, don't hand-wave.

**D4. Tier 0 uncapped on a 120 Hz iPad is self-defeating.** §8.3: ">90 Hz display and the frame graph is tight → start at tier 0 uncapped." At 120 Hz the frame budget is 8.3 ms, and the table's own subtotal is 12.4 ms. Every ProMotion iPad therefore starts at tier 0, stutters for 45 frames, and visibly drops to tier 1 within the first second of play.
**Fix:** always cap render to 60 Hz (skip alternate rAF callbacks). And state the budget as a function of refresh rate rather than a constant 16.7.

**D5. `maxSubSteps = 5` is the wrong choice for this audience, and "invisible" is wrong.** 5 sub-steps means the sim can be 83 ms behind the player's finger and then *catch up in a burst*. For a 6-year-old whose mental model is direct manipulation, "I let go and the car kept driving" is the single most confusing failure a driving game can produce — far worse than slow-motion, which they will read as a fun effect. Also, 5 × 3.4 ms = 17 ms of sim plus 5.5 ms of render is 22.5 ms, which produces another backlog; the claim that §4.2's clamps prevent compounding is unverifiable from the text and is the classic spiral-of-death handwave.
**Fix:** `maxSubSteps = 2`, and on overflow **discard** the accumulator remainder (time dilation) rather than catching up. Log the discarded time to the overlay. This is a deliberate, audience-driven choice and should be stated as such.

**D6. Continuous zoom is a self-inflicted wound.** Hotspot #4 (cache thrash on zoom), the nearest-bucket fallback, `bmp.unitScale` rescaling, and 3× the cache memory all exist to support smooth zoom that a 6-year-old neither needs nor will use.
**Fix:** **three fixed zoom levels** (drive / wide / map), tweened between over 250 ms with a temporary nearest-bucket scale during the tween only. Bake exactly 3 buckets. This deletes hotspot #4, cuts ShapeCache memory ~3×, and removes an entire fallback path.

**D7. One budget table for two very different reference devices.** A 2019 Celeron (N4000) Chromebook is roughly 4–6× slower than an A12 in Canvas2D, at 1366×768.
**Fix:** two budget columns, or state plainly: "Chromebook boots at tier 2 by default (`hardwareConcurrency <= 2 && !isIOS`), where the target scene is 20 traffic / 120 particles / renderScale 0.7."

**D8. Headless profiling misses the systems most likely to go O(n²).** `SystemRunner.forHeadless` drops every presentation system, so `SimReport.systemMs` never covers `RenderCollectSystem`, culling, the sort, or particles — which is exactly where quadratic blowups happen (naive culling against every entity, per-particle sorting).
**Fix:** run `RenderCollectSystem` + sort in headless against a `NullRenderer` that accepts and discards the `DrawList`. Report `commandCount`, `sortMs`, `collectMs`. Also replace the `AudioEngine` with `context: null` (null-checks at every call site) with a `NullAudioEngine` implementing the same interface — you already have DI.

---

## E. Age-appropriateness

**E1. "A four-finger simultaneous tap held for 1.5 s — a six-year-old will not produce that."** Yes they will. Kids rest palms on tablets constantly and a palm registers as multiple touch points; kids also drum on screens. Worse, on iPad **four- and five-finger gestures are intercepted by iPadOS** (pinch to home, swipe to switch apps), so the gesture may never reach the page at all. So it is simultaneously too easy to trigger accidentally and unreliable when deliberately attempted.
**Fix:** the debug overlay is reachable **only** via `#dev` in the URL (parent types it) or via a proper parent gate in Settings: press-and-hold a specific corner for 3 s, then answer "what is 7 × 4?" with a numeric keypad. The parent gate is needed anyway (§12 mentions it once at M7, undefined) — spec it here as an engine module: `ParentGate.request(reason): Promise<boolean>`, used by the debug overlay, save wipe, and any external link.

**E2. `renderHzCap: 60` "a difference a six-year-old will never perceive" — backwards.** Halving refresh rate roughly doubles touch-to-photon latency. In a follow-finger or virtual-stick driving game, latency is precisely the axis on which a child with poor fine motor control suffers most. The cap may still be the right call for frame-budget reasons, but do not justify it with a false perceptual claim, and do not apply it before other levers.
**Fix:** ordering within a tier step-down is: particles → traffic → renderScale → *last of all* renderHz. Never cap refresh in tier 1.

**E3. Particle degradation collides with the reward loop.** §11.6 says "nothing gameplay-critical may be communicated by a particle effect," but the coin-burst on a completed delivery is the single most important feedback signal in a game built for a pre-reader, and it is unambiguously a particle effect. One `particleBudget` number forces the art lens either to violate the rule or to build the reward out of non-particles.
**Fix:** two pools. `Fx.Essential` (reward burst, pickup sparkle, dropoff confetti) with a **hard reserve of 60 particles, never scaled by tier**; `Fx.Ambient` (exhaust, leaves, dust, rain) scaled by tier. `EmitterDef` carries a `priority: 'essential' | 'ambient'` field and the essential pool cannot be starved by the ambient one.

**E4. The `flailing`-reaches-vehicle-2-in-20-minutes gate is set to the wrong number.** The brief says 5–15 minute sessions. A gate of 20 minutes of *flailing* means a realistic first session ends with zero progression — no new vehicle, nothing collected, nothing to come back for. That is the retention question, and the gate as written permits failure on it.
**Fix:** three gates, all measured on `Policies.flailing`: a visible reward (coins, sound, number going up) at least every **45 s**; the first *cosmetic* unlock within **4 min**; vehicle 2 within **8 min**. Add a monotonicity assertion: `money` is non-decreasing across the entire run under every policy (no path exists that reduces it except an explicit purchase).

**E5. The `child` policy — "60% path efficiency, wanders" — is a fabricated number carrying the entire economy tuning.** Three significant figures of false confidence.
**Fix:** `tape record` already exists. Record 10 minutes of an actual 6-year-old at the M2 playtest, extract observed metres-per-minute, mean heading error, idle fraction, and off-road fraction, and calibrate `Policies.child` to match those four measurements. Until that data exists, the policy is labelled `child_UNCALIBRATED` and tuning decisions made against it are provisional. Note also that the `child` policy's parameters must be re-measured after every control-scheme change.

**E6. Nothing in the architecture handles a thrown exception, and there is no telemetry.** One bad `undefined` in one system kills the rAF loop; the screen freezes; the child has no idea what happened and no parent can diagnose it. On a static site with no server, this is unrecoverable and invisible.
**Fix (missing essential):** wrap `runner.fixedUpdate` and `render` in try/catch at the `GameLoop` level. On throw: push the error to a 20-entry ring buffer in `localStorage`, disable the offending system for the rest of the session, and if the same system throws 3 times, transition to an `OopsScene` — a friendly animated character, no text beyond one word, and one big button that reloads and restores the last good save. `window.onerror` and `unhandledrejection` route to the same place. `#dev` surfaces the ring buffer so a parent can screenshot it. This is the entire crash-reporting strategy for a serverless build and it is currently absent.

**E7. No audio fallback.** On iPad, WebAudio is silenced by the hardware mute switch, and there is nothing a web page can do about it. The brief states that for a pre-reader, "icons, numbers, colors, and audio carry meaning." A muted iPad therefore removes an entire communication channel with no signal to anyone.
**Fix:** every audio cue has a mandatory redundant visual — enforce it in the API: `Audio.cue(id)` requires a paired `FxDef`, and a test asserts every registered `SfxId` appears in at least one `CueDef` with a visual. Additionally, detect silence (render one `AnalyserNode` frame after the first cue; if peak is 0 while `state === 'running'`) and show a one-time mute-switch hint icon.

**E8. No portrait handling, no minimum viewport, no orientation policy.** A 6-year-old holds a tablet in whatever orientation they picked it up in.
**Fix:** state a minimum supported CSS viewport (e.g. 640×360), landscape-preferred with a working portrait layout (camera zooms out 15%, HUD moves to the bottom edge), and `orientation: landscape` in the manifest for the home-screen case. All of this is downstream of I2 (viewport-relative UI), which is already right — just say so.

---

## F. Internal contradictions

**F1. `__DEV_TOOLS__` tree-shakes the overlay out of production AND `#dev` re-enables it in production.** Both are asserted in §7.5. Pick one.
**Fix:** split. A ~3 KB `MiniOverlay` (fps, tier, build id, seed, error count) is always in the prod bundle. `DebugOverlay` full mode and `DevConsole` live in a chunk loaded via `await import('./dev/tools')` when `#dev` is present — works fine on Pages, costs one HTTP request only for a parent following bug-report instructions, and keeps them out of the main bundle.

**F2. §9d says `ctx.players` is an array from day one; §9b then budgets a save migration to convert `profile` → `profiles[]`.** If the invariant holds, the save should be `profiles: [p]` from v1 and the migration is unnecessary.
**Fix:** `SaveSchema.v1.profiles: PlayerProfile[]`. Zero cost now, one fewer migration later.

**F3. §7.2 rule 3 bans reading the camera in `fixedUpdate`, but `PlayerControlSystem` reads "the previous frame's camera snapshot" — which is reading the camera in `fixedUpdate`.** It is the right design; the rule as written forbids it.
**Fix:** restate as: "`fixedUpdate` may read only `slot.cameraSnapshot`, an immutable per-player struct written once per frame in `lateUpdate` and versioned by frame index. No system may read a live `Camera` object." Also: `ViewportRouter` assigns a pointer to a player by viewport hit-test — **latch that assignment at `pointerdown` for the lifetime of the pointer**, or a child dragging across the split line hijacks the other player's car mid-drag.

**F4. `AdaptiveQuality` "NEVER changes anything gameplay-visible" is false in its own table.** `ambientTrafficCount` 40→12 changes road density and therefore difficulty; `renderHzCap` changes input latency, which is gameplay.
**Fix:** drop the claim and replace it with a bound: "no tier change may alter the sim; traffic count is the sole exception and is clamped to [12, 40], a range validated in headless to change `moneyPerMinute` by < 5%." Then actually run that check in `npm run sim`.

**F5. "Steps DOWN after 45 consecutive frames with p95 frameMs > 18" is not a well-defined criterion.** p95 over what window? If p95 is a 120-frame rolling stat, a single 3-frame hitch keeps p95 elevated for 120 frames, and "45 consecutive frames of elevated p95" is trivially satisfied by one bad hitch.
**Fix:** p95 over the trailing 120 frames, **evaluated every 30 frames**. Step down one tier if p95 > 18 ms on two consecutive evaluations (~1 s). Step up one tier if p95 < 11 ms on 20 consecutive evaluations (~10 s). Suppress all evaluation for 90 frames after a district load, a tab resume, or a tier change (bake storms are not a steady-state signal).

**F6. `DigitRenderer` "bakes 0–9 glyphs" — from what font?** The project bans external assets; system fonts differ across iPad (SF), Chromebook (Roboto), Windows (Segoe). §8.2 correctly bans everything else that isn't procedural, then quietly relies on `fillText` for the one element that appears on screen constantly.
**Fix:** define the ten digits as procedural vector paths in `src/game/art/shapes/ui/digits.ts` (~12 lines each, thick rounded strokes matching the art style). For the `TextCache` words, cap the lexicon to a fixed, checked-in list of ≤ 24 strings so both platforms' renderings can be reviewed in `#gallery`; anything not in the list fails a lint check.

---

## G. Missing essentials

- **Pause semantics.** Nothing defines what happens to an in-progress ride when the tablet sleeps for an hour. (The §7.2 ban on `Date.now` in systems gets you the right answer for free — no timer is wall-clock-based — but say it out loud, because it is a load-bearing audience decision: nothing ever expires while the game is closed.)
- **A settings/parent surface.** `AdaptiveQuality.setManual` exists with no UI. There is no mute, no save export, no "reset progress" behind a gate, no control-scheme picker despite §11.3 offering three. Spec `SettingsStore` as a separate persisted blob from `SaveFile` (so wiping progress doesn't reset volume) with its own tiny schema and its own version.
- **Save/load determinism test** (C3) and **per-stream RNG persistence** (B8).
- **A quota-exceeded path.** `localStorage.setItem` throws in Safari Private Browsing and when full. Currently unhandled — the write is budgeted at 0.5 ms and assumed to succeed. Catch, fall back to in-memory, and set a "progress not being saved" flag surfaced to the parent.
- **Bundle/load budget and a first-run flow.** Nothing describes what a child sees for the first 2 s.
- **Chunk tile memory pool** and total-canvas-bytes accounting (A2).

---

## H. Build order

**M2 is too late for the only genuinely high-risk unknown, and M5 is far too late for the first playtest.** The control scheme determines the camera, the road width, the assist strength, the vehicle turn rate, and the economy's metres-per-minute. Discovering at M5 that follow-finger doesn't work invalidates M3 and M4 tuning.
**Fix:** insert **M2.5 "Toy test"** — the drivable car on a blank plane with all three control schemes hot-swappable via a hidden gesture, and a 20-minute session with a real 6-year-old. Gate: one scheme is usable without adult help within 60 s. Record a tape at this session and use it to calibrate `Policies.child` (E5).
**Also:** move save/load from M7 to M4. Without persistence, no playtest can answer the session-to-session question, which is the retention question. Move `AdaptiveQuality` to M3, or every playtest before M7 runs at an unknown quality tier and you learn nothing about performance from them.

---

## Strong ideas that MUST survive into the final spec

1. **Bake everything to bitmaps; `setTransform` + `drawImage` with zero `save`/`restore` and manual `globalAlpha` tracking.** This is the correct Canvas2D flush loop and the single most load-bearing decision in the document.
2. **`ChunkBaker` tiles as the static layer.** Correct answer to the "static world redrawn every frame" problem, and the right reason to use one canvas rather than three.
3. **The banned-feature list** (`shadowBlur`, `filter`, `clip`, non-`source-over` composite, per-frame gradient creation) with the `shadowBlob` and colour-variant-baking replacements. Enforce it by lint rather than by runtime test, but keep every item.
4. **Headless simulation with named driver policies, especially `flailing` as a floor.** The best idea in the document. "Can a child who barely understands the controls still make money?" is exactly the right question for this audience, and answering it in CI instead of by replaying the game 90 times is genuinely excellent.
5. **`npm run sim` as the economy-tuning instrument**, and §11.5's offer to tune content tables against target minutes-to-unlock supplied by the design lens.
6. **The determinism lint rules** — particularly the bans on `Date.now` and `setTimeout` in sim code, which buy correct sleep/resume behaviour as a side effect.
7. **Seeded RNG with named sub-streams**, and the insight that `fx` randomness must be free to diverge.
8. **`RecordingContext` op-budget tests** and the `#gallery` scene as the visual-review mechanism for an agent that cannot see.
9. **`DigitRenderer` for all numbers**, and the constraint that words are rare, short, and cached.
10. **The three day-one insurances** — `Transform.z` + `LayerId.Air`, `ctx.players[]` + viewport-relative UI + `RenderPass`, and `NavMask` on edges. Each is a data field plus a parameter rather than an abstraction, and the discipline of admitting only these three is right.
11. **The hotspot register with named owners**, and the no-allocation house style for hot loops (index `for`, out-params, preallocated scratch) — correctly identified as the rule an AI-authored codebase will violate by default.
12. **The explicit "what is not tested" section.** Rare, honest, and it keeps the suite fast.
13. **Boot ordering constraints** (shapes registered before the cache is sized; save loaded before the world so you don't build and discard a city).
14. **M0–M2 as the architecture proof point with a stated escape hatch** — if `ShapeCache` misses its numbers at M1, revisit before 15,000 lines exist on top.