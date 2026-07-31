# Adversarial review — "Child UX & Game Feel" spec

## A. Fatal contradictions (fix before anything else)

**A1. The camera rotation cap inverts the steering mapping. This breaks the entire control scheme.**
§1.2 caps camera angular velocity at 90°/s and freezes camera rotation below 0.8 m/s. §2 gives the car a max yaw rate of **150°/s at ≤2 m/s**. So the car can out-rotate its own camera by 60°/s, and below 0.8 m/s it out-rotates it by 150°/s with *zero* compensation. Do the arithmetic on the behavior the doc explicitly encourages ("doing donuts in the park"): 2 s of spinning at low speed leaves the car pointing **down** the screen. At that moment "finger on the left = go left" is false — the exact failure the heading-up camera was chosen to prevent — and the recovery whip is itself banned by §8.6.
**Fix:** the rendered car body is *locked* to screen-up with a hard ±15° visible yaw clamp; heading error above that is absorbed by the camera, and the camera's angular cap is raised to 200°/s while the error exceeds 15° (this is legal because the car sprite, the thing the eye tracks, is not rotating). Additionally clamp *simulated* yaw to 110°/s at all speeds and re-verify turn radius against 44 m blocks (at 2 m/s, r = 1.04 m — still far below need). Below 0.8 m/s, do not freeze camera rotation; freeze camera *translation* only.

**A2. Every sound in the first 30 seconds of onboarding is illegal.**
§4.1 assigns audio to t=0 (engine idle rumble), t=0.8 s (two-note chime), t=8 s (boop), t=16 s (passenger vocalization) — all **before the first user gesture**. §8.4 states the AudioContext is unlocked by the first steering touch. Both cannot be true. On iPadOS the entire attract sequence is silent, and the doc's cleverest idea (invisible audio unlock) is what makes it silent.
**Fix:** the pre-touch attract loop is **visual-only, by contract**. Move the wake-up chime, idle rumble, boop, and passenger call to *after* first touch. The 8 s / 16 s / 30 s escalations become: hand scales 1.2× (8 s), passenger waves + emits a visual speech-shape (16 s), car creeps forward and looks back (30 s). Add to §9's checklist: "Does any beat before `firstGesture` schedule audio?" Also missing: on `visibilitychange` return, Safari leaves the context `suspended` — you must explicitly `resume()` on the next gesture, or sound never comes back for the rest of the session.

**A3. There is no way to stop the car.**
Dead zone → magnitude 0.40. Finger behind car → 0.30. Release → 45% for 4 s, then a 1.2 s glide. Minimum sustained speed is ~2.5 m/s and the fastest possible full stop is **5.2 seconds**. A 6-year-old who wants to park next to a duck, look at their new paint job, or hand the tablet over cannot. This also fights the toy layer (§3.2 item 8) and it means the auto-unstick (§1.6) fires constantly while a child leans on a wall watching the cat window.
**Fix:** finger held inside the 70 px dead zone for >350 ms ramps magnitude to 0 over 500 ms; the car parks with a "sit down" squash and a headlight blink. Keyboard `↓` held 700 ms → 0. This is one extra state and it is the single most-requested affordance in kids' driving toys.

**A4. Palm rejection does not work on the primary device.**
`radiusX`/`radiusY` are not exposed on Safari's PointerEvent (`width`/`height` are reported as fixed placeholder values for touch), so the radius test is a no-op on iPad. Worse: **"the first pointer down owns steering"** means a resting palm — which lands first when a tablet is flat on a table, the normal posture for this age — permanently owns steering and the actual driving finger is ignored, with no visible cause. That is the exact rage-quit mode §1.4 rejects option (b) for.
**Fix:** ownership is *transferable and movement-based*. The steering pointer is the most-recently-moved pointer that has travelled >20 px within the last 500 ms. A pointer that has not moved >8 px in 1.2 s forfeits ownership and never re-claims it without movement. Drop the radius heuristic entirely. Also: the "ignore pointers within 30 px of a screen edge" rule must be scoped to *steering claims only* — as written it can swallow the horn press of a thumb wrapping the bezel.

**A5. Reduced Motion silently disables the control scheme.**
§8.2 caps camera rotation at 45°/s. A 90° junction turn executed in 1.2 s needs 75°/s. So the players who most need input consistency get a permanently drifting car heading. The two sections contradict without acknowledging it.
**Fix:** under `prefers-reduced-motion`, switch to a **world-up (fixed-north) camera** and switch input to *screen-absolute* steering: the finger's screen-space bearing from the car becomes the car's target world heading directly. No rotation at all, no mapping inversion, mapping is still "finger up-left = drive up-left." Force assist L3. Spec this as a first-class mode, not a degradation.

---

## B. Performance — this will not hit 60 fps as specified

**B1. No device-pixel-ratio decision exists.** A 2019 iPad (A10, DPR 2) at the reference 1180×820 is **3.87 Mpx per frame**. With a rotating world, particles, and any overdraw, Canvas2D misses 60 fps on fill rate alone.
**Fix, required:** two canvases. World canvas at `min(devicePixelRatio, 1.5)` (2.18 Mpx), HUD/text canvas at full DPR so numerals and icons stay crisp. Add an automatic step-down to 1.25 then 1.0 if the 30-frame rolling p95 exceeds 15 ms.

**B2. `shadowBlur` is implied everywhere and is the #1 Canvas2D perf killer.** "Drop shadow" on the ghost hand, "88 px glowing ring", "soft light shaft", "glitter trail", "streetlights flick on one by one", "light sweep across the body", "fireworks."
**Fix:** ban `shadowBlur` and per-frame `createRadialGradient` in the render loop, as a lint rule. All glows are pre-rendered gradient sprites in an offscreen atlas, composited with `globalCompositeOperation = 'lighter'`. Night lighting is **one** full-screen `multiply` fillRect with a lerped tint, plus ≤24 additive light-cone sprites. §3.2's claim that day/night and rain "cost nothing" is false unless this is mandated — tiles must never be re-rendered for time of day.

**B3. The rotating world defeats naive tile caching, and the doc never mentions how the world is drawn.** Heading-up means nothing is axis-aligned.
**Fix, required and missing:** pre-render static geometry into **axis-aligned world-space tile canvases** (512 CSS px ≈ 17.5 m at default zoom), then blit visible tiles under a single rotated transform. At the corrected max view height (~46 m → ~66×46 m visible) that is ≤20 blits/frame. Tire tracks, puddle marks, and road chevron decals render *into* the tiles with a 256-decal cap and dirty-tile invalidation — otherwise "tire tracks that fade over 8 s" is an unbounded per-frame draw list.

**B4. No aggregate particle budget.** Tier 3 alone is 24 confetti + 8 coins + 3 hearts + a firework; add continuous off-road grass emission from wheels, bump dust, near-miss speed lines, and 3–6 NPCs.
**Fix:** single pooled array, hard cap **400** live particles, one draw pass, no per-particle `save()`/`restore()`, no per-particle `rotate()` (use pre-rotated sprite frames, 16 steps). Oldest-first eviction. Reduced Motion ×0.35 applies to the cap, not just spawn counts.

**B5. NPC "polite AI" with a 12 m forward-cone query is a large system for a toot.**
**Fix:** NPCs are spline followers with a single scalar `yield` state driven by one distance test against the player and one against their own lookahead point. No cone, no steering behaviors. Cap at 12 active NPCs inside camera + 20 m.

**B6. Frame-rate acceptance criterion is untestable as written.** "≥58 fps, <1% frames over 20 ms" is ambiguous on a 120 Hz iPad Pro.
**Fix:** "p99 frame time ≤ 16.6 ms and p99.9 ≤ 24 ms at DPR 1.5 on a 2019 iPad, measured over a 5-minute scripted drive." Also: fixed-step interpolation must include the **camera angle** (shortest-arc lerp) or the whole world jitters — not stated anywhere.

---

## C. Age-appropriateness failures

**C1. The bonus star is a countdown wearing a hat.** §3.1 bans countdowns, then specifies stars decaying 3 → 2 → 1 over 90 s. A 6-year-old watching a star vanish experiences loss, full stop; "framing is always earn more" is not true of the described implementation, and it violates the doc's own Pillar 2.
**Fix, same math, zero removal:** show **0 stars at pickup** and *fill* them as route progress accrues — star 1 at 60% remaining, star 2 at 30%, star 3 on arrival if within 90 s. Nothing ever disappears. Identical payout curve, opposite affect.

**C2. Assist L3 forbids leaving the road for the first ~10 minutes, deleting the toy layer.** §1.5 L3: "Can leave the road? No — soft rubber band at road edge." §1.6 and §3.2 promise park donuts, grass shortcuts that are "sometimes genuinely faster", leaf piles, and puddles. For the entire onboarding and first-purchase window, none of that is reachable. The park is behind an invisible wall during the exact minutes the child is exploring what the toy does.
**Fix:** L3 keeps a strong centerline pull (3.0 m/s²) but **no hard rubber band** except at water and the map edge. Rubber-banding is a boundary tool, not a difficulty tool.

**C3. The assist demotion rule punishes the behavior the game rewards.** "Step up one level immediately on 3 wall bumps within 10 s" — but §1.6 makes bumping walls delightful (cats, shutters, boings). A child playing with the bumpers gets their steering freedom silently confiscated. That is Pillar 2 ("nothing is ever taken away") violated by the game's own tuning code.
**Fix:** demotion keys only on *distress*: ≥2 auto-unstick events in 60 s, any hint-ladder escalation past L3, or failure to reach an objective in 75 s. Never on bumps, never on off-road time. And assist strength may only *decrease* within a session; it re-raises on a fresh boot.

**C4. The parent gate is defeatable and the wrong cognitive test.** "SEVEN · TWO · NINE" as words — number words are explicit sight-word curriculum at ages 5–6 in both US K and UK Reception. Many target-age children can read them. This gate protects **save deletion**, the doc's own stated worst outcome.
**Fix:** gate on a skill that is not taught before ~8: `4 × 7` with a numeral keypad, or `13 + 19`. No reading at all. Add 3 failures → 60 s cooldown with no retry affordance. Keep the 3 s hold-to-enter.

**C5. Hover-drive is a bug, not a feature.** A desktop pointer resting on the canvas for 0.6 s drives the car at 70%. Moving the mouse toward the pause button drives the car. A parent who lets go of the mouse to talk comes back to a car in a hedge.
**Fix:** cut it. Desktop is button-held drag, or WASD. There is no user for whom "the car drives when I am not touching anything" is legible.

**C6. Two corner buttons flanking the steering zone, and the handedness claim is false.** §1.4 asserts left- and right-handers are equally served, but §5.6 places the garage at bottom-left and the horn at bottom-right. A left-thumb steerer resting at bottom-left triggers the garage.
**Fix:** put horn and garage on the **same** side, stacked, and mirror them from a handedness flag auto-detected from the running median x of the steering pointer over the first 60 s (re-evaluated each session, never announced).

**C7. Near-miss coins are either free or impossible.** "+1 coin within 1.2 m at >70% speed" — at L3 the car is pinned to the centerline. Either every lamppost pays (blowing the Tier-1 cadence budget from above and trivializing the price curve) or none do.
**Fix:** near-miss requires the obstacle to be off the car's committed path; per-obstacle cooldown 10 s; global cooldown 3 s; award 1 coin, capped at 12/minute.

**C8. Auto-unstick will fire constantly.** Trigger is `speed < 0.4 m/s for 2.5 s with non-zero intent` — and per A3 the child cannot stop, so any deliberate lean against a wall qualifies. Being teleported while playing is unfair and unexplained, exactly what it was meant to prevent.
**Fix:** require *all* of: in contact with collision geometry, <1.5 m net displacement over 4 s, non-zero intent, and ≥3 s since the last fire.

---

## D. Buildability gaps and missing numbers

**D1. The zoom formula is inert.** `clamp(speed * 2.0 / 0.62, 28, 38)` at the taxi's top speed of 8.5 m/s yields 27.4 → clamps to 28. The rule does nothing until 8.68 m/s, i.e. never in the first hour. And 2.0 s of lookahead at 8.5 m/s is 17 m — under half a 44 m block, so at the 5 m junction auto-slow the child cannot yet see the exits they are choosing between.
**Fix:** `viewHeight_m = clamp(18 + speed * 2.4, 30, 46)`, car anchored at 62% screen height (lookahead = 0.62 × viewHeight). At 8.5 m/s → 38 m view, 23.6 m lookahead ≈ half a block. Add a hard readability floor: the car must never render shorter than **60 px**, which caps view height at 57 m and therefore caps any future vehicle's top speed at ~16 m/s. Put that constraint in `tuning.ts` as an assertion.

**D2. `Intent { angle, magnitude }` cannot express the behaviors the spec requires.** §11 exposes only those two fields, but §1.3 needs "hold last steering sign", "hold current heading", "coast — do not turn at junctions", and §4.2 L5 needs "autopilot blended at 40% with player intent". None are representable. The handoff interface is broken on arrival.
**Fix:** `Intent { angle, magnitude, mode: 'active' | 'coast' | 'park' | 'assisted', source: 'touch' | 'mouse' | 'key' | 'pad' | 'autopilot', confidence: 0..1 }`. `confidence` is what the assist blender weights; autopilot writes `mode:'assisted', confidence:0.4`.

**D3. "junction-intent success > 80%" is undefined and will divide by zero.** If the child never flicks, there are no samples.
**Fix:** a junction intent is recorded when `|angle| > 25°` within 8 m of a junction node; success = the car exits via the outgoing road nearest that angle. Fewer than 4 samples in the 90 s window → treat the metric as passing.

**D4. The dropoff trigger radius is never specified.** Pickup is 1.5 m; dropoff is not given. At 8.5 m/s pinned to a centerline, a building-adjacent point can be missed repeatedly with no explanation.
**Fix:** dropoff zone is a 6 m radius circle centred on the road adjacent to the building; auto-slow to 45% within 8 m; triggers at any speed. With multiple passengers, **entering any carried passenger's zone drops that passenger**, in any order, always — state this, or the "no wrong destination" guarantee is undefined for the 7-seater.

**D5. Passenger spawn rules are entirely absent.** The doc asserts a fare is always available and re-arms 600 ms after dropoff, but never says where they spawn, minimum/maximum route distance, reachability, or what prevents a spawn across the §7.1 river with no bridge on the path.
**Fix:** spawn on a sidewalk node whose graph distance from the player is 130–220 m, reachable without leaving the road graph, not within 25 m of the previous dropoff, and never in the 90° cone directly behind the player. Precompute the route at spawn time; reject and resample if no route exists.

**D6. The job card does not survive the progression the doc promises.** 280 × 100 px with one portrait, and §7.1 introduces multi-passenger fares, and the vehicle ladder ends at a bus.
**Fix:** cap **concurrent visible jobs at 3** regardless of seat count; card grows to 380 × 100 (2 jobs) and 480 × 100 (3). Seats above 3 grant passengers who share a destination with an existing job (drawn as a stacked portrait with a count pip). Without this, the bus tier produces an unreadable HUD and a cognitive load no 6-year-old can hold.

**D7. The bus and limo break the control model, unaddressed.** "A longer vehicle that bends around corners" under leash steering, with a 7 m turn radius on 44 m blocks, is a second vehicle model and a geometric-sticking generator.
**Fix:** all vehicles share **one** collision footprint scale and a turn radius capped at 9 m; simulated wheelbase grows ≤25% across the whole ladder. Articulation and length are **cosmetic only** — a rendered follow-segment with no collision volume. State this now or the bus is unshippable.

**D8. Two checklist items block the spec's own features.** "Any state where touching the screen does nothing for >500 ms" blocks the 500 ms hold-to-buy (§5.5) and the 900 ms resume pulse (§8.7). "No HUD in the bottom-center 420×260" blocks the ghost hand at 62%/50% (§4.1).
**Fix:** reword to "does nothing *visible*"; classify the ghost hand as a non-interactive world-layer element; and make any touch during the resume pulse skip it immediately.

**D9. "No child-facing string contains a non-digit character" is unenforceable without a mechanism.**
**Fix:** all numerals route through a single `num()` formatter; the lint rule is "no string literal or template literal may be passed to `ctx.fillText` outside `num()` and the parent-gate module." That is checkable in CI.

---

## E. Missing essentials

**E1. No offline story, and GitHub Pages will break the paths.** The #1 context for a 6-year-old's tablet is a car or a plane. There is no service worker, no cache strategy, no boot budget. And GH Pages serves from `/<repo>/`, so an absolute-path SW scope or absolute asset paths fail on day one.
**Fix:** cache-first service worker over the whole build (<2 MB with no assets), registered with a **relative** scope; a static inline-SVG splash car painted in <400 ms; time-to-interactive <2.5 s warm on a 2019 iPad. Add `manifest.webmanifest` with `display: standalone` — this is also what removes Safari's edge-swipe-back gesture, which will otherwise navigate away mid-drive and is not mentioned anywhere.

**E2. No returning-player boot path exists.** §4.1 covers only the very first run; the HUD is "born" at the first pickup. What does a child with 400 coins and a limo see on boot two? Undefined.
**Fix:** returning boot = garage scene for 1.2 s (album, gift box, work-in-progress vehicle all visible), car drives out, control granted at ~2.0 s, HUD already present. Ghost hand returns on any boot after >72 h absence.

**E3. No profiles. One localStorage save means the sibling wipes the garage.** The doc calls save loss "the worst outcome this product can produce" and then ships a single slot.
**Fix:** up to 3 slots selected by **car silhouette + color only**, no names, no text. Shown on boot only if >1 profile exists; a single-profile install boots straight into the world per §4.1.

**E4. Nothing anchors the world. There is no "go home."** Heading-up + no minimap + a second district with a river means the child cannot navigate to anything the beacon isn't pointing at — which kills exploration, the thing the toy layer depends on.
**Fix:** the garage is a physical building in the world with a permanent, distinctly-shaped border chevron in its own color, always on screen. That single anchor is what makes an unmapped rotating world legible.

**E5. Audio carries meaning with no visual redundancy, and iPads are muted constantly.** The affordability chime, the sleepy note, the honk reactions, the coin-chain melody. Roughly half of the feedback design silently disappears behind a hardware mute switch, which is undetectable from JS.
**Fix:** hard rule — **no state change may be signalled by audio alone**; every cue in §6 needs a paired visual in the same table cell. Audit the Delight Stack table for this explicitly.

**E6. No motor-accessibility path.** Everything requires sustained contact. A child with limited grip or a hand tremor cannot play at all.
**Fix:** behind the parent gate, a "tap to drive" mode — tap a point, car drives there and stops; tap the car, it parks. This is nearly free given the `Intent` abstraction plus the L5 autopilot code that already exists.

**E7. Playtest criterion #9 is not a design criterion.** "Unprompted return, parent-reported, ≥5/10 on ≥4 of 7 days" requires a week-long longitudinal study with 10 families, and it is a retention KPI sitting awkwardly beside §7.3's explicit anti-engagement stance.
**Fix:** replace with "≤1/10 children show distress at session end", measurable in one sitting.

**E8. Variable-ratio special passengers vs. the dark-pattern ban.** §3.2 endorses "variable ratio reward" as "the strongest engine available" while §9 categorically bans engagement dark patterns. Keep the feature, but bound it so it is anticipation rather than a slot machine.
**Fix:** rarity never below 1-in-12; **every fare displays its tier before pickup** (so it is a visible choice, not a reveal); there is no "miss" outcome; no streak or pity counter.

**E9. Scope the reactive world before it eats the schedule.** "Driving to an incorrect landmark triggers a friendly wave animation from that building" implies every building is animated and reactive.
**Fix:** only the ~8 destination-shape landmarks are reactive; all other buildings are static tile geometry with a bump squash. Same for "a window shutter pops open and a cat looks out" — 6 authored reactive props total, placed by hand, reused.

---

## Genuinely strong — must survive into the final spec

1. **The `Intent` vector as the single input abstraction** (with the `mode`/`confidence` fix in D2). One code path across four devices is correct and rare.
2. **Follow-my-finger positional steering.** The reasoning against fixed sticks, dynamic sticks, and hold-to-go is right, and the failure modes cited are real.
3. **The affordability ring.** Converting "do I have enough" from a numeric comparison into a fullness judgment is the best single invention in this document and should be reused for every threshold in the game.
4. **Before/after pips and countable chair pips.** Seven drawn chairs instead of the numeral 7 is exactly right for the cognitive stage.
5. **Hold-to-buy with a filling ring** as anticipation *and* mis-tap protection — one mechanism solving two problems, no reading.
6. **The hint escalation ladder**, especially the no-modal / no-text / no-dismiss rule and the L5 soft autopilot that disengages on the first productive touch.
7. **The Delight Stack as one data-driven table** with tiers, plus the coin-chain semitone ladder.
8. **The reward-cadence debug overlay in week one**, and the spawner contract that guarantees a Tier-1 event within 8 s. Build both.
9. **The Day Cycle + Goodnight button** as the ending mechanism. "Letting the child choose to end" is the most valuable insight in the document and almost no children's game does it.
10. **The no-fail audit table** (§3.1) — keep it verbatim as the design's constitution, minus the star (C1).
11. **The horn as a first-class system**: pitch variation, the three-press flourish, rate-limiting audible honks while never producing a dead press.
12. **Parent gate + hold-to-confirm + 5 s undo for save reset** (with the C4 gate swap).
13. **`touch-action: none` / `overscroll-behavior: none` / `-webkit-touch-callout: none`.** Pull-to-refresh mid-drive is a real, common progress-wipe and most teams find it in production.
14. **The anti-pattern PR checklist** as an enforced review gate, with the D8/D9 rewordings.
15. **"Traffic lights always turn green"** — an obstacle repurposed as a reward generator, at essentially zero cost.