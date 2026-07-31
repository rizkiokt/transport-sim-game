# Adversarial Review — "Procedural art direction & animation juice"

**Scope note:** I was given only §8 (tail) through §11. Sections 1–7 are referenced (`§5.0 ease library`, the double-stamp trick, the "stroke pipeline") but not shown, so I cannot verify the numbers they allegedly justify. Every concrete figure in this excerpt — 420 particles, 320 blits, 600 px/s, 8 sparkles — is asserted with **zero device measurement behind it**. That is the meta-problem: the proposal reads as budgeted but is actually budgeted in the wrong unit (see #10).

---

## A. Constraint violations

**1. `OffscreenCanvas` is assumed and is not universally available on the target device.**
`bake.ts` opens with "OffscreenCanvas pool." iOS Safari only shipped `OffscreenCanvas` in 16.4. "The oldest supported iPad" (acceptance test 7) very plausibly tops out at iPadOS 15. The bake layer — which the *entire* art direction depends on — silently fails there.
**Fix:** `bake.ts` exposes `createBakeSurface(w,h)` returning `OffscreenCanvas | HTMLCanvasElement`, feature-detected once at boot; never touch `OffscreenCanvas` types elsewhere. Forbid worker-based baking entirely (transfer cost + no `ImageBitmap` guarantee); bake on the main thread, time-sliced (#18).

**2. No font strategy, but numbers are load-bearing.**
`bakeGlyphAtlas` is listed and then never specified. Canvas2D `fillText` resolves to a *system* font: SF on iPad, Roboto on Chromebook, something else on desktop. Your fare digits, your money counter, and your capacity readout will differ in width, weight and shape per device, breaking every baked layout. You cannot fetch a webfont from a CDN (constraint) and the agent cannot author a full typeface.
**Fix:** Ship **10 digit glyphs + `$` + `/` + `+` + `x`** as hand-authored `Path2D` polylines in `paths.ts` (~14 glyphs × ~12 points = trivial to author, fully deterministic, scales crisply, outlines for free via double-stamp). Rule: **no `fillText` anywhere in the shipping renderer.** Any word-level text is parent-facing only and may use system fonts.

**3. `reverb.ts` (procedural IR + ConvolverNode) is a luxury that will cost you the frame budget.**
A 2 s stereo convolution on a 4 GB Chromebook is a steady 5–12% of one core, and the audio thread starving causes glitches that a 6-year-old perceives as "broken." The payoff — mild spatialization in a cartoon city — is near zero.
**Fix:** Delete `reverb.ts`. Replace with a 3-tap feedback delay (delays 37/53/71 ms, feedback 0.35, one-pole lowpass at 3.5 kHz) on a single "space" send bus. ~0.3% CPU, indistinguishable at this art level.

**4. Seeded determinism is never mentioned — the city will be different every launch.**
Buildings, characters, hair, species are all procedurally generated with no stated seed source. A 6-year-old will absolutely notice that "my house" moved and will be upset. It also makes acceptance test 5 (adjacency) and test 7 (5-min benchmark) unrepeatable.
**Fix:** One `worldSeed: uint32` written to the save on first launch, never changed. All generators take an explicit seed derived as `hash(worldSeed, lotId)`. A `?seed=` query param for dev. Deterministic replay is also the only way test 7 is measurable at all.

---

## B. Age-appropriateness

**5. "streak-10 celebration" imports a fail state through the back door.**
A streak that can be *broken* is a loss. The brief says explicitly: losing money/progress causes quitting and tears. The art lens is here quietly adding a punishment mechanic by celebrating a fragile counter.
**Fix:** No streaks. Celebrate a **cumulative, monotonic count** — every 10th delivery ever, forever. Same timeline, same 4 s payoff, zero loss aversion. If the systems lens insists on a streak, the art lens must refuse to render a "streak lost" state at all.

**6. The sunset/night set piece makes the game harder to see, and dark is scary.**
`gradeAt()` returns a `multiply` pass. A 6-year-old with a tablet on a sunny kitchen table, screen at 40% brightness, in a world graded down for night, cannot find the pickup beacon. And some 6-year-olds are genuinely frightened by a world going dark on them without warning.
**Fix:** Hard cap `multiply` luminance at **0.62** (never darker), and exempt gameplay-critical layers: passengers, beacons, coins, and the player vehicle are drawn **after** the grade, ungraded, at full contrast. Add a parent-settings toggle **"Always Daytime"** that pins `gradeAt` to noon. Night must be scenery, never a difficulty modifier.

**7. Cinematics are skippable in the API but not in the design.**
`timeline.ts` says "Skippable, seekable" — a 6-year-old does not know to skip, and does not know *how*. A 6 s+ non-interactive sunset the fourth time you see it is where the tablet gets put down.
**Fix:** (a) **Any** pointerdown/keypress fast-forwards the timeline to `t_end - 400ms`. (b) The full set piece plays **once, ever** (flagged in the save); subsequent triggers play a 1.8 s abbreviated variant. (c) Nothing over 1.5 s ever blocks input — the child can keep driving *through* the celebration; the camera may lead, but steering stays live.

**8. The character generator is combinatorial when it needs to be memorable.**
"12 hair styles × 12 species head modules" + random palettes yields hundreds of near-identical strangers. A 6-year-old's actual joy loop is *recognition and collection* ("the fox lady again!"). Random variation delivers neither, and it directly fights acceptance test 5's "no two visible passengers are identical" which requires a runtime dedupe pass nobody specified.
**Fix:** A **fixed cast of 16 named characters**, each with a distinct silhouette at 24 px (tall/round/tiny/eared/hatted), a signature color, and a signature voice-blip formant. Vary only pose, expression and an accessory. Recognition becomes free, dedupe becomes a 16-slot bitmask, and it enables a future "passengers you've met" collection screen — which is exactly the collecting mechanic the audience loves.

**9. Number popups with no cap on magnitude.**
`numberPopup()` is listed with no constraint. A 6-year-old reads 1–2 digits reliably and 3 digits poorly. Fares of `$137` are noise; `$1,240` is meaningless.
**Fix:** The art lens imposes a **display constraint on the economy lens**: no on-screen number ever exceeds 3 digits during play. Fares 1–99. Above that, popups switch to **coin-glyph stacks** (1 / 5 / 25 coin denominations, drawn as physical objects of increasing size and shine) — quantity is read as *size and sparkle*, not as digits.

**10. Nothing addresses what happens when the child drives into a wall for 20 seconds.**
This is the single most common real behaviour of a 6-year-old with a driving game, and the art module list has no response for it. Silence here reads as "broken."
**Fix:** `juice.emit('bonk')` — 0.18 s squash to 0.85× along the impact normal, an 8-particle dust puff, a comedic descending "boing" (two-osc, 220→150 Hz, 140 ms), and a 6 px camera nudge (**not** trauma shake). Rate-limited to one per 350 ms so wall-grinding produces a rhythmic, funny loop instead of a machine-gun. Zero damage, zero cost, no fail state.

---

## C. Buildability / hand-waving

**11. `bakeBuilding` per-instance × day+night will exhaust canvas memory on iPad Safari.**
Two states per building at, say, 128×192 px is ~196 KB per building. 250 buildings = **~49 MB of canvas backing store**, on top of the world tile bakes, character bakes, particle atlas, and light sprites. iOS Safari kills tabs well before you expect it to, and a killed tab is indistinguishable from a crash to a child.
**Fix:** Bake **archetypes, not instances**: 24 pictograms × 8 families = 192 baked pairs, shared by reference across hundreds of instances. Per-instance variety comes from horizontal flip, a 3-step height scale applied at blit time, and a per-instance window-lit bitmask drawn as blits from `bakeLightSprites`. State an explicit budget in `bake.ts`: **32 MB LRU byte cap, evict on `pageshow`/visibilitychange, assert in dev.** "A byte budget" without a number is not a spec.

**12. Tweens and the camera spring run on the RENDER clock — this contradicts the stated fixed-timestep architecture.**
`tween.ts`: "Advanced by the RENDER clock." A variable-dt spring is non-deterministic, breaks the 5-minute repeatable benchmark, and can visibly overshoot or explode when the frame time spikes to 60 ms. Worse, if any tween ever writes gameplay-relevant state (a passenger becoming boardable when its arrival tween lands), you have a sim/render desync.
**Fix:** Two pools. `simTween` advances on the fixed step and may write sim state. `fxTween` advances on the render clock and is **statically forbidden** from writing sim state (enforce by giving it only a cosmetic-state target type). The camera spring sub-steps at a fixed 120 Hz with an accumulator, `dt` clamped to 50 ms. And give the numbers the proposal omits everywhere: follow spring ω = 11 rad/s, ζ = 1.0; punch-in ω = 20, ζ = 0.55; lookahead = velocity × 0.35 s, clamped to 180 px; deadzone 40×28 px.

**13. `paths.ts` "all cached by parameter hash" is an unbounded leak.**
Hashing float parameters (`vehicleSilhouette(profile, L, W)`) means a vehicle that lerps its width during an upgrade animation allocates a new `Path2D` every frame, forever. Over the 5-minute test this is a guaranteed GC-churn failure.
**Fix:** Quantize all path parameters to a fixed grid before hashing (lengths to 2 px, radii to 1 px, angles to 3°), cap the cache at **512 entries with LRU eviction**, and dev-assert on cache miss rate > 2% over 300 frames. Prefer unit-space prototypes + `setTransform` over parameterized regeneration wherever the shape is affine-scalable.

**14. `bakeCharacter → poses[4]` contradicts "a pedestrian waving" in acceptance test 3.**
Four baked poses is a flipbook. A wave needs continuous arm rotation or it looks like a glitch. The proposal simultaneously promises baked characters and live procedural liveliness.
**Fix:** Pick one, and it should be **live**: characters are 7 `Path2D` parts (legs×2, body, arms×2, head, hair) drawn with per-part transforms. 7 fills + 1 shadow + double-stamp outline on the body silhouette only ≈ **10 draw ops per character**; 24 pedestrians = 240 ops, affordable. Bake only the *head module* (the expensive part: face, ears, hair detail) as a 4-expression sprite sheet and `blitRotated` it onto the live body. This is the version that passes test 3 and test 5.

**15. The set piece needs a spatial ordering that no listed system provides.**
"A light-up wave" ordered by distance from the plaza requires per-frame distance sorting of visible buildings. `draw/*.ts` are declared stateless and `timeline.ts` only holds `{atMs, fn}`. Claiming "not one new drawing primitive is required" hides a real new data requirement.
**Fix:** At world gen, precompute `waveRank: uint16` per building (quantized distance from the plaza) into the static building array. The wave is then `lit = waveRank < waveFront`, an integer compare per building, zero sorting, zero allocation. Say this in the spec; it is the difference between 200 lines and a performance bug.

**16. `CinematicMode` is undefined.**
During the set piece: what do the 14 AI vehicles do? Does the player's car keep rolling into a building? Do fare timers keep running? Does an in-progress delivery complete mid-cinematic and stack a second celebration? All undefined, all shipping bugs.
**Fix:** Define `cinematic.enter(opts)` / `.exit()`: suspends fare/patience timers, sets AI vehicles to `hold`, damps player input to 0 over 250 ms (never instant), queues any celebration triggered during the cinematic into a FIFO played on exit, and guarantees restore via `try/finally`. Only one cinematic may be live; the second call fast-forwards the first.

**17. No authoring tool for the timeline = 30 rebuild cycles to tune 6 seconds.**
A keyframed set piece you cannot scrub is a week of work disguised as 200 lines.
**Fix:** Dev-only overlay: `[` / `]` scrub, `\` loop, on-screen `t` in ms, and hot-reload of the timeline module via Vite HMR. Two hours of work, saves two days.

**18. No boot-time budget, and everything is baked at boot.**
Procedural art means the CPU pays at startup. 192 building bakes + character heads + glyph atlas + particle atlas + asphalt pattern on a 4 GB Chromebook is plausibly 1.5–4 s of blocking main-thread work. A 6-year-old staring at white gives up.
**Fix:** **Time-to-first-interaction ≤ 2.0 s on the worst device, hard gate.** Bake in slices of ≤ 6 ms per frame across the boot rAF loop, ordered: player vehicle → road/ground → nearest 30 buildings → everything else. The child can drive at 1.2 s while the city is still populating in. The loading screen is itself procedural (a spinning wheel drawn with `paths.ts`), which is also your first smoke test of the pipeline.

---

## D. Performance

**19. The budget is stated in draw calls; the thing that kills Canvas2D on tablets is fill rate.**
"420 particles" and "320 blits" tell you nothing about whether it fits. A 420-particle burst of 8 px sprites is ~27 k px. Two full-screen grade fills at 2360×1640 are **7.7 million px of composited blending** — roughly 300× the particle cost, and it's the item the proposal treats as free.
**Fix:** Budget in **overdraw multiples of the framebuffer**: Tier A ≤ 2.5×, Tier B ≤ 1.8×, Tier C ≤ 1.3×, at render scale. Add a dev-mode counting Painter that reports draw calls **and** approximate covered pixels per layer, displayed live on the tablet. Secondary caps: ≤ 900 draw calls/frame Tier A, ≤ 450 Tier C.

**20. `applyGrade` = "2 full-screen fills" with `multiply` and `screen` composites. This is the most likely single cause of missing 60fps.**
Non-`source-over` composite over the full canvas is among the slowest Canvas2D operations on mobile Safari and frequently drops the layer out of GPU fast-path.
**Fix:** Kill the `screen` pass entirely — bake its effect into the **sky gradient** (which you're already drawing, so it costs nothing) and into the pre-tinted variants of the light sprites. Keep at most **one** `multiply` rect, drawn at render-scale resolution over the *world* layer only (not UI, not the player, per #6). Budget it at ≤ 1.2 ms and verify on device in phase 8, not phase 12.

**21. DPR is never mentioned. This is the classic 60fps killer.**
iPad reports `devicePixelRatio` 2; some Chromebooks 1.5–2.25. Rendering a 2360×1640 backbuffer at 60 Hz with 2.5× overdraw on an A10 is not happening.
**Fix:** `renderScale = clamp(min(DPR, 2.0) × tierScale, 0.6, 2.0)` with the ladder **1.0 → 0.85 → 0.72 → 0.60**. Crisp vector art with heavy outlines degrades gracefully at 0.72; nobody will see it. Change render scale only between frames and never during a celebration.

**22. `ctx.shadowBlur` must be explicitly banned, and "every object has a shadow" invites it.**
`shadowBlur` is 10–50× slower than an equivalent fill on mobile and is the #1 trap an engineer implementing "no object without a shadow" will fall into.
**Fix:** Write it into the spec as a rule: **`shadowBlur`/`shadowColor` are forbidden in the shipping renderer** (dev-mode Painter throws if set). Shadows are (a) baked into static object sprites, or (b) one pre-baked soft ellipse sprite blitted at `globalAlpha` 0.22, scaled by object footprint. Cloud shadows are the same sprite at alpha 0.12 with `source-over` — **never** `multiply`.

**23. The degrade state machine has no hysteresis spec, so it will oscillate.**
`quality.ts` lists "frame-time ring buffer, degrade/upgrade state machine" and no thresholds. Naive implementations flip tiers every second during a coin burst, which is more visually jarring than just running at 45fps.
**Fix:** Degrade when p95 of the last 120 frames > 20.0 ms. Upgrade only when p95 of the last 600 frames < 13.0 ms. Minimum dwell 10 s per tier. **Never change tier while a cinematic or celebration is live.** Degrade order is fixed and stated: render scale → particle caps → ambient life count → window sparkles → cloud shadows → grade pass → star layer.

**24. Photosensitivity cap is measured in the wrong unit.**
"3 flash rings per second globally" controls one effect. The clinical guideline concerns **luminance transients over ≥25% of the screen at >3 Hz**, and saturated red is separately hazardous. A 6-shell firework with additive sparkles produces many transients that your ring counter never sees.
**Fix:** Cap the *aggregate*: track mean framebuffer luminance (approximate: sum of emitted additive alpha × coverage, computed at emit time — no readback). No more than **3 events per second** where mean luminance rises > 10% frame-over-frame. Hard-forbid saturated red (>0.85 sat, hue 340–20°) in any flash or additive layer. Both rules live in `quality.ts`, not in the firework code, so future effects inherit them.

---

## E. Internal contradictions

**25. "The moment lands at every tier" vs. Tier C banding by 12.**
At Tier C you have fewer visible buildings; banding groups of 12 with ~30 on screen gives you ~3 steps. Three steps is not a wave, it is a slideshow.
**Fix:** Band by **screen-space distance into a fixed 8 bands** at every tier. Band count, not building count, is what makes it read as a wave — which is exactly the proposal's own stated principle, applied correctly.

**26. "No more than three values per object" (test 2) vs. the phase-1 object, which has five.**
Double-stamp outline + base + shade + light + face ink = 5 values. The acceptance criterion as written fails your own hero asset.
**Fix:** Restate: "**≤3 values in the body** (base, `deriveShade`, `deriveLight`), plus one outline ink and one face ink, both drawn from a fixed 2-entry ink palette." Now it is testable and passable.

**27. Gentle Mode is invoked twice and defined nowhere.**
`camera.setGentleMode()` and "in Gentle Mode the flash rings are replaced" — but what does it do to trauma shake, speed lines, engine volume, night darkness, particle count, horn loudness? Each subsystem will invent its own interpretation.
**Fix:** One exported const struct consumed by every subsystem: `{ shake: 0.25, flashAlpha: 0.25, particleScale: 0.5, speedLines: false, punchIn: 0.4, gradeDarkestMultiply: 0.80, sfxGain: -6dB, musicGain: -9dB, cinematicMaxMs: 2500 }`. Persist in the save. Auto-enable when `prefers-reduced-motion: reduce` is set — which the proposal never checks at all.

**28. Acceptance test 4's 30 ms audio latency is physically unachievable on the targets.**
Chrome OS audio output latency alone is commonly 40–80 ms; iOS WebAudio adds 10–40 ms on top of the touch pipeline. You will fail your own gate.
**Fix:** Targets: **visual response ≤ 50 ms** (achievable and the one that actually carries perceived immediacy), **audio ≤ 100 ms, hard fail at 150 ms**. Require `new AudioContext({ latencyHint: 'interactive' })`, report `baseLatency + outputLatency` in the dev HUD, and pre-schedule SFX at `ctx.currentTime` with **zero** lookahead offset. Also drop the high-speed camera as a gate (unreasonable): instrument `pointerdown` timestamp vs. the rAF timestamp of the first frame containing the change; slow-mo phone video is a spot check, not the measurement.

**29. `quality.ts` is phase 12 — you cannot retrofit tiering into 11 phases of finished draw code.**
Every emitter, every draw path, and every bake must consult tier caps from the first line written. Shipping-gate-at-the-end also concentrates all perf risk in the final phase, after the schedule is spent.
**Fix:** `quality.ts` moves to **phase 1** as a constants module + frame-time ring buffer + on-tablet dev HUD. Every phase ends with a "runs at 60fps on the worst device" checkpoint. Phase 12 becomes tuning, not implementation.

---

## F. Missing essentials

**30. There is no UI / HUD / shop art module. At all.**
`draw/*.ts` covers vehicles, characters, buildings, trees, roads, water, coins, bubbles, beacons — and nothing for the garage, the shop, the vehicle-select carousel, the paint picker, the pause screen, or the HUD. The shop is where the entire progression pillar lives and is the screen the child will stare at longest. This is the largest hole in the proposal.
**Fix:** Add `draw/ui.ts` + phase 5.5 in the build order: 9-slice procedural panels (rounded rect + inner light + outer shadow, all `roundRectPath`), a chunky button spec (**min 88×88 CSS px touch target, 120 px for primary actions**, 12 px gap minimum), pressed state = 4 px downward translate + 0.94 scale + a 60 ms click, locked state = greyscale + padlock pictogram (never a text explanation), affordable state = a slow gold shimmer sweep. Price is shown as coin-glyph stacks per #9. The vehicle carousel renders live 3/4 silhouettes via `vehicleSilhouette`, not baked screenshots.

**31. Wayfinding gets exactly one function name (`drawBeacon`) and it is the most important art job in the game.**
A 6-year-old who cannot find the passenger stops playing in under 90 seconds. Nothing in the module list handles off-screen targets.
**Fix:** Specify the full kit: (a) a ground beacon — pulsing ring, 1.4 s period, plus a bobbing arrow 60 px above ground; (b) an **off-screen edge indicator** — a 56 px arrow chevron clamped to a 40 px screen inset, sized by inverse distance, tinted to the passenger's signature color, with the passenger's head sprite inside it; (c) a **breadcrumb trail** — 14 dots along the route spline, drifting toward the target at 90 px/s, alpha 0.35, drawn under vehicles; (d) pickup vs. dropoff distinguished by **shape** (circle vs. square) as well as color, per test 6. This is 4 effects, not 1, and it should be phase 4, not implied.

**32. Vehicle progression — the game's actual pillar — is one hand-waved signature.**
`vehicleSilhouette(profile, L, W)` is asked to cover taxi → 7-seat → limo → bus → "beyond," plus 12 paints and "better looks" upgrades. There is no spec for how a bus reads at 24 px vs a limo, how occupancy is displayed at 3 vs 7 vs 12 seats, or what a "better looks" upgrade actually changes visually.
**Fix:** Define profiles as **discrete authored control-point sets**, not a parametric family — 6 profiles, each hand-tuned to pass the 24-px test against the other 5 (taxi: short+domed; 7-seat: boxy+tall; limo: extremely long+low; bus: tall+flat+double-door). Occupancy is shown as **window portholes that fill with passenger head sprites**, capped at 6 visible + a "+n" coin-glyph for buses — a child reads "car is full" from filled windows without counting. Cosmetic upgrades are a fixed slot list (roof sign, spoiler, rims, stripe, horn-chrome, flag), each an independent `Path2D` overlay drawn in a defined z-order, so the shop grid is combinatorial but the art is 6 small assets.

**33. No WebAudio unlock flow.**
Audio cannot start before a user gesture, and there is no specified first-touch unlock. The child taps, hears nothing, taps again — first impression ruined.
**Fix:** Boot screen is a single giant tappable vehicle. First pointerdown resumes the context, plays a warm confirmation chord, and starts the game. Also handle `visibilitychange` → suspend/resume, and iOS silent-switch behaviour (audio routes to the silent category unless you play through a media-type context — note it so nobody spends a day on the "no sound on iPad" bug).

**34. No screen-shape spec.**
Tablet portrait, tablet landscape, and a 16:9 Chromebook show wildly different amounts of world. Untreated, the child sees more road on one device than another, which changes actual difficulty.
**Fix:** Guarantee a **minimum visible world height of 18 m and width of 24 m**; letterbox with decorative border art rather than letting the camera zoom out arbitrarily. Respect `env(safe-area-inset-*)` on all HUD anchors. Lock to landscape with a friendly "rotate me" illustration in portrait (procedurally drawn, no text).

**35. Test 5's adjacency rule has no generation strategy.**
"No two adjacent buildings share a silhouette *and* a color" is a constraint-satisfaction requirement stated as an acceptance test with no algorithm.
**Fix:** Per-lot selection from a **shuffled bag** with a 2-lot lookback rejection on `(pictogramId, familyId)`; on 8 failed draws, accept and force a family swap. Deterministic under `worldSeed`, O(1), done.

**36. Music will drive parents out of the room.**
`music.ts` "adaptive rules" is undefined, and a 6-year-old plays the same 15 minutes daily.
**Fix:** Spec it: 4 layers (bass, chords, arp, perc), 16-bar phrases, a seeded chord-sequence chooser drawing from 8 progressions, so a session is not literally identical. Music sits **9 dB under SFX**. Music toggle is one tap from pause, and the setting persists. Sidechain-duck music by 6 dB for 250 ms on any celebration.

---

## Must-preserve strengths

1. **One `timeline.ts`, four payoffs.** Reusing the set-piece system for the 2.5 s first delivery, 4 s milestone, and 1.2 s paint flourish is genuinely excellent leverage. Keep it.
2. **Set pieces built from existing gameplay systems — "not one new drawing primitive."** The right instinct, and it's what makes the wow moment affordable. (It just needs the `waveRank` precompute from #15 to actually be true.)
3. **Degradation preserves *timing and scale*, not particle count.** This is the correct theory of why a moment lands, and it should govern every tier decision in the project.
4. **The two one-line APIs** — `juice.emit(name, opts)` and `audio.play(name, opts)` — plus the rule that a gameplay engineer writing easing math inline means the art system has failed. Non-negotiable; it is what keeps the art direction consistent as features accrete.
5. **Photosensitivity and Gentle Mode treated as first-class design constraints**, not an accessibility bolt-on. Right call, needs the tighter definitions in #24 and #27.
6. **The acceptance tests**, especially the 24-pixel silhouette test, the greyscale test, the 30-second stillness test, and the behavioural 6-year-old test ("if they ask *what does it say?*, the UI has failed"). These are unusually good and rare; keep all of them, with the fixes to tests 2 and 4.
7. **Build order phases 1–2**: prove the car alone is fun to steer around an empty green field, on a real tablet, in week one. This is the single most valuable line in the proposal.
8. **Struct-of-arrays particles, pooled tweens, pure stateless draw functions, pure cached path factories.** The right architecture, given the cache bounds from #13.
9. **Baked day/night building states cross-faded** rather than relit per frame. Correct trade — just bake archetypes, not instances (#11).