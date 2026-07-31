# Adversarial review — "Systems, Economy & Progression"

## A. The numbers do not survive contact with a calculator

**A1. The cost formula and the "actual ladder" tables disagree in 8+ places.**
`round5(base * growth^(L-1))` does not produce the printed ladders.

| Track | L | Formula gives | Spec prints |
|---|---|---|---|
| Turbo | 7 | **720** (25×1.75⁶=718.07) | 715 |
| Turbo | 9 | **2200** (2199.1) | 2195 |
| Turbo | 10 | **3850** (3848.4) | 3845 |
| Comfort | 4 | **190** (187.6) | 185 |
| Comfort | 6 | **575** (574.5) | 560 |
| Comfort | 10 | **5390** (5387.8) | 5250 |
| Grip | 8 | **820** (820.7) | 825 |
| Seats | 3 / 4 | **1440 / 3455** | 1450 / 3500 |

Why it matters: §7 says "no number in this document may appear in engine code," so the engine will ship the *formula* while the designer balances against the *table*. Comfort's formula total is 12,525 vs the printed 12,210. The §7.6 validator's 15% tolerance is wide enough to never catch it.
**Fix:** delete `kind:'geometric'` entirely. All six tracks use `kind:'table'` with explicit arrays. Formulas generate tables *offline*, never at runtime.

**A2. §3.6 "cadence proof" is arithmetically impossible and it is the most important table in the doc.**
- 0:35, wallet **24**, buys a 25-coin paint. Off by one, in the game's first purchase.
- Implied earn rates between rows: 0:35→1:10 = 94/min, 1:10→1:45 = **120/min**, 1:45→2:30 = **140/min**, 2:30→3:20 = 132/min, 3:20→4:40 = **146/min**. Tier-1 income at upgrade level 0 is **87/min** per §3.4. Every row after the second is inflated 40–70%.

**A3. §3.5's `R × 1.35` is circular and breaks worst in tier 1.**
To be at +35% income you need ~Comfort 5 (35+60+105+185+320 = **705 coins**) — more than the tuk-tuk costs. In tier 1 the real multiplier is ≈1.00–1.05, not 1.35.
Real tier-1 time = 300 / (87 × 0.55) = **6.3 min minimum**, and the spec's own 1.8–2.5× dawdle factor makes the first vehicle purchase land at **11–16 minutes**, not 4.7. That is the single most important retention beat in the product and it is off by 3×.
**Fix:** tuk-tuk drops to **150**; grant a scripted 40-coin "first paycheck" on ride 1 so purchase #1 is guaranteed regardless of how slow ride 1 was; re-run §3.5 with a *per-tier achievable* upgrade multiplier (1.00, 1.08, 1.15, 1.22, 1.28, then 1.35 cap) rather than a flat 1.35.

**A4. §3.4 income excludes tips and Rainbow Rush, which §3.2/§5.5 guarantee.**
Rush = 30 s at ×2 every 5 deliveries. At tier 1, 5 deliveries ≈ 81 s of play → **+37% income**. At tier 11, ≈72 s → **+42%**. Add ~10% expected tips. Real income is **1.4–1.6× the table**, so every "minutes in tier" is ~35% optimistic and the ×1.38 ratio discipline is measured on a baseline the game never runs at.
**Fix (preferred):** Rainbow Rush pays **zero extra coins**. Give it rainbow road, faster music, confetti, a screen-wide sparkle, and star/sticker progress. A 6-year-old cannot perceive a coin multiplier; they can perceive the rainbow. If you keep the coins, fold `rushDutyCycle` and `expectedTipMult` into the validator's income model as first-class terms.

**A5. §4.4's `P(groupSize > seats) ≈ 0.25` is mathematically incompatible with §3.4's average group sizes.**
Taxi: 3 seats, avg group **1.7**. A triangular distribution with mean 1.7 puts essentially zero mass above 3 (you'd need max ≈ 6, which forces mean ≈ 2.7). Van: 7 seats, mean 4.2 → triangular(1, 2.6, 9) gives P(X>7) = 4/51.2 = **7.8%**, not 25%. The contradiction is systemic across every tier, and the oversize-group moment is the doc's own load-bearing "buy a bigger vehicle" argument.
Also: `sampleTriangular(min, mean, max)` — triangular takes **(min, mode, max)**; mean ≠ mode. The signature is wrong.
**Fix:** publish explicit `(a, c, b)` triangular params per vehicle plus the closed form `P(X>s) = (b−s)²/((b−a)(b−c))` for s ≥ c, and stage the oversize rate: 0.10 (T1–3), 0.18 (T4–6), 0.25 (T7+). Then re-derive §3.4's `G` from those params instead of asserting it.

**A6. `routeEff` is a fudge constant the CI gate depends on, and it is unmeasured.**
The doc admits it is "used ONLY by the balance validator." If a real 6-year-old drives at 0.35 rather than 0.60, every income number is 40% low and every tier duration 70% high — and CI passes green forever. The §7.6 validator is currently a machine for validating a fiction.
**Fix:** build a headless **bot driver** (pure-pursuit controller + a Gaussian steering-error term + a 15% chance/second of a random detour input). Run it 200 rides per tier in CI, write `measured.json`, and have the validator use *measured* cycle times, failing the build when `|measured − hint| > 20%`. This is a day of work and it is what makes §7.6 real.

---

## B. Age-appropriateness — where a 6-year-old actually breaks

**B1. Six purchasable upgrade tracks is at least three too many, and one of them is a trap.**
⚡Turbo vs 🎯Grip is a distinction an emerging reader cannot form. §2.3 states outright that "speed and controllability must rise together" — and then sells them separately. A 6-year-old buys the lightning bolt ten times and zero targets, arrives at +40% speed with base steer-assist, and hits exactly the failure the doc lists as risk #7.
**Fix:** three tracks only — **⚡ Speed, 💰 Money, 🪑 Seats**. Steer-assist scales automatically off `turboLevel` (never purchasable). Horn sounds become cosmetics. Lights are deleted (see B6). Re-derive the upgrade budget: ~19 levels, ~27,000 coins total.

**B2. A5 ("a 6-year-old can read every number") is contradicted by the economy it defines.**
Typical 6-year-old number sense is reliable to ~20, shaky to 100. "2,195" is noise. "🏅3 🪙 240" requires base-1000 place value — a Grade 3–4 concept. The doc caps the wallet at 99,999 and builds an 82,000-coin depot.
**Fix:** **divide the entire economy by 10.** Taxi ride = 2 coins, tuk-tuk = 15, school bus = 290, rocket bus = 1,500, depot total = 8,200. Every price is ≤4 digits and most are ≤2. Delete gold-bar notation entirely. Display the wallet primarily as a **physically filling coin jar**, with the numeral secondary; show prices as a second jar the child compares by height. Comparison-by-size is available at 6; comparison-by-numeral above 100 is not.

**B3. The Piggy Bank is the single most regret-generating action in the game and it violates axiom A2.**
"Swap 10,000 coins → 1 cosmetic trophy" is a purchase a child cannot evaluate, and if mis-tapped it annihilates their savings. Is it covered by the 7-second undo? Undefined.
**Fix:** delete it. Handle wallet overflow with an **automatic, non-interactive** overflow: coins above the cap silently accumulate into a trophy shelf with a fill meter. No decision, no loss, no tap.

**B4. The 7-second undo is worse than the problem it solves.**
A shrinking coin icon in the corner is an unlabelled mystery button to a non-reader — the most likely outcome is a curious tap that *cancels a wanted purchase*, which is precisely the tears the axioms exist to prevent. It also collides with the 4-second unskippable vehicle-reveal cinematic: by the time the reveal ends, the undo window is nearly gone.
**Fix:** delete the undo. Replace with a **picture confirm on anything costing ≥ 25% of the current wallet** (big art, green thumb / grey X, no text, no timer). Under that threshold, a mis-tap costs <20 seconds of play and needs no protection. Keep the 400 ms debounce.

**B5. Extra Riders (§4.4) puts a multi-stop routing problem in front of a child who has owned one vehicle.**
Three simultaneous coloured destination arrows at tier 4 is a planning task. Colour-coded hats also fail for ~8% of boys (deuteranopia) — and the doc leans on colour for the arrow, the trail, *and* the landmark.
**Fix:** **exactly one active destination, always.** Extra riders board and ride to the shared destination as bonus coins, no second arrow, ever. Encode all wayfinding identity as **colour + shape** (star / heart / circle / square on both the hat and the beacon).

**B6. Night reduces visibility, and the Lights track exists only to sell the visibility back.**
A dark screen in a dark room, plus a "night vision radius" a child must pay 3,160 coins to fix, is a stealth difficulty tax wearing an upgrade costume. It also makes the world scarier for the exact age group that quits over scary.
**Fix:** night is a **palette change with full visibility** — deep blue sky, warm glowing windows, neon stops, headlight cones as pure decoration. Delete the Lights track.

**B7. Several "content" features are hidden penalties in violation of A1/A2.**
- `weightClass`: `accelMult = 1 − 0.02 × sum(weight)`. With 30 passengers this is 0.4; with heavy `robot` types it goes **negative** — undefined behaviour, and it means *succeeding* (full bus) makes the vehicle worse.
- `robot`: −10% accel, stated as a feature.
- `grandma`: ×1.4 "bonus if you never exceed 60% speed" — a hidden conditional a 6-year-old will fail and will experience as a punishment for driving normally.
- `chicken`: takes control/progress away for 3 seconds of comedy; a 6-year-old reads that as "I broke it."
**Fix:** delete `weightClass` from the sim (keep it as a suspension-squash visual only). Robots have no accel penalty. Grandma always pays ×1.4 and knits/waves — if you want a slow mechanic, make it a *visible* green speed dial that pays confetti, not coins. The chicken escapes at **drop-off**, after the coins land.

**B8. Dwell times of 3–4 s (plane, rocket) are 6–8 seconds of dead input per ride.**
That is an eternity at this age, and it arrives exactly when rides are longest.
**Fix:** cap all dwell at **1.5 s**, and make it interruptible — drive away early and remaining passengers hop in with a whoosh. Boarding animation overlaps the first second of driving.

**B9. Unskippable animations teach "the game is frozen."**
"No skip button for 4 s" on vehicle reveal, a 2.5 s counter that "don't let anyone skip," a 5 s district flyover, a 3 s scripted takeoff. A 6-year-old mashes the screen; nothing responds.
**Fix:** every celebration is **tap-to-fast-forward** — a tap jumps the animation to its end state (it never *removes* the reward beat). Never block input for more than ~800 ms.

**B10. "Unaffordable items greyed but never hidden" produces a wall of dead buttons.**
12 vehicles + 112 cosmetics, mostly grey, mostly tapped repeatedly with no response.
**Fix:** show **the next 1–2 locked items only**, as a silhouette with a filling progress ring. Everything further out lives in a "Gallery" the parent opens.

**B11. Star gates are functionally identical to delivery-count gates, and they lock things the child can afford.**
Stars = days completed (deliveries/8) + missions cleared (~2 of 3/day, i.e. near-automatic). Coins = sum of fares. Both are linear in ride count. The claimed function — "a fast kid can't skip the world" — does not exist, because there is no way to get rich without doing rides. What the gates *do* achieve is the failure mode: a child with 4,400 coins staring at a tram they cannot buy, for an invisible reason, expressed in a symbol they cannot count to 27 in.
**Fix:** (a) stars **never gate vehicles** — coins are always the binding constraint on the ladder. Stars gate only *districts and features*, where "a new place opened" reads as a gift rather than a denial. (b) Any star-locked item shows **no price at all** — a silhouette plus a visibly filling star meter. (c) Set every star gate at ≤55% of expected stars so it is essentially never the binding constraint.

---

## C. Buildability

**C1. Seven locomotion systems and six districts is 5–10× the rest of the build.**
`road | offroad | rail | water | air | space | float` = seven distinct movement models, plus Sky Islands, plus the Moon, plus "rail network in **all** districts" at ⭐27 (re-authoring six district graphs), plus flight with landing. This is not a v1.
**Fix:** **v1 ships tiers 1–7** (taxi → school bus), all `road`/`offroad`, two districts (Downtown, Beach). The schema keeps every `Locomotion` value; only two are implemented. Tram/ferry/plane/rocket become a roadmap with data stubs already validated by the balance tool. The doc should say this explicitly, because right now an engineer reads it as a single deliverable.

**C2. The tram's "steering is removed" is undefined at every junction.**
Who chooses the branch when the kid is holding one pedal? What happens when the destination stop is not on the tram's line? How does the tram get to the depot?
**Fix:** one closed loop per district, single direction, destinations sampled **only from stops on the loop**, junctions auto-select toward the target with a flashing arrow 2 s ahead. State it, or cut the vehicle.

**C3. The plane requires landing — a precision task, i.e. the one thing the audience brief forbids.**
Undefined: flying off the map, missed approach, collision with terrain.
**Fix:** no landing skill. Fly over the destination pad → a 2 s scripted auto-descent triggers. Map edges are soft-bounded by a wind-push, never a wall or a reset.

**C4. The content volume is hundreds of hand-authored procedural draw recipes.**
24 paints + 30 hats + 40 placeable decals + 8 wheel sets + 10 trails = 112 cosmetics, each needing vector draw code, **× 12 vehicle silhouettes** for anchoring. `cosmeticSlots: { hat: [x, y] }` is a single 2D point — insufficient for a hat that must sit on a tram, a balloon, and a monster truck at different scales and rotations. Placeable decals with 3 slots implies a drag-to-position UI: fine-motor-hostile and a whole editor.
**Fix:** paints become a **single palette-swap parameter** (24 is then free). Cut to **8 hats, 0 placeable decals** (replace with 8 fixed-anchor stick-ons chosen from a list), **4 trails**. Change the anchor to a full normalized transform `{pos:[x,y], scale, rot}` authored once per (vehicle, slot).

**C5. Functions inside "data."**
`requiresVehiclesOwned: (level: number) => number` and `MissionDef.goal.amount: number | ((tier: number) => number)` are not JSON-serializable and cannot be validated by a boot-time schema check — directly contradicting §7's "`*.json` (validated at boot)."
**Fix:** declarative forms only: `{kind:'linear', m: 1, b: 1}`, `{kind:'table', byTier:[…]}`.

**C6. The road graph — the foundation everything rests on — is never specified.**
Distance bands, `distanceMatrix`, "24 stops per district," "1 block = 20 wu," and the entire fare formula presume a road graph that is neither authored nor generated anywhere in the doc. Are districts hand-built? Procedurally generated? With what tool? An AI agent with no level editor hand-placing 144 stops plus roads plus buildings across six districts is a large, unacknowledged cost.
**Fix:** name it. Recommendation: districts are **procedurally generated from a seeded grid template** (a 12×12 cell lattice, cells tagged road/building/park, stops placed at graph nodes with degree ≥ 3), with the seed stored per district so the map is stable across sessions. `distanceMatrix` = BFS on the node graph at boot (24² = 576 entries, sub-millisecond). Landmark colour/shape assigned round-robin from an 8-entry palette so no two nearby stops collide.

**C7. `checksum` is anti-cheat theatre with a catastrophic failure mode.**
A static site has no secret; the checksum stops nobody. But if a mismatch causes rejection, a benign localStorage quirk wipes a child's bus collection — the doc's own "worst possible bug."
**Fix:** checksum is a **corruption detector only, never a rejection**. On mismatch: snapshot to `save.backup`, load anyway, repair missing fields with defaults. Also add the missing specs: `QuotaExceededError` handling, localStorage-disabled fallback (in-memory + a visible "progress won't be saved" parent notice), and multi-tab last-write-wins.

**C8. No autosave policy exists.** A 6-year-old closes the tab mid-ride.
**Fix:** write on every economic event (delivery, purchase, day end, district change), debounced 500 ms, plus on `visibilitychange` and `pagehide`. Never on a rAF tick.

**C9. `Math.floor(Date.now()/86400000) % 7` is UTC-based and clock-exploitable.**
The theme flips at midnight UTC (mid-afternoon in the US). Changing the device clock re-rolls the event; "Double Sticker Day" is one-time-reward-adjacent.
**Fix:** hash the **local** date string; persist `lastEventDay` and `lastSeenLocalDate` in the save; if the clock moves backwards, hold the current event rather than reverting. No event may alter one-time rewards (stickers) or fare multipliers — events change **appearance and spawn mix only**.

---

## D. Performance (Canvas2D, iPad 6 / low-end Chromebook)

**D1. Up to ~120 individually-drawn characters on screen.**
Tier 9–11: 4 waiting groups × up to 30, plus a 30-passenger vehicle. Each procedurally drawn character is ~20 path ops with fills and strokes. That is 2,000+ path operations per frame before the world is drawn. It will not hit 60 fps; it will not hit 30.
**Fix:** hard budget of **24 rendered characters**. Any group >6 renders as a **crowd blob**: one clustered body mass + N bobbing heads + a numeral badge. Pre-render each character type once to an offscreen canvas (per palette variant) and `drawImage` it — never re-path per frame. Passengers **inside** the vehicle are never drawn as characters; they are the seat-window dots the van already uses.

**D2. The Candy Trail is a Canvas2D perf cliff.**
A dotted, animated, scrolling path on the road surface, over an 8–12 block route (240 wu) = hundreds of stroked dots per frame, or an animated `setLineDash` over a long path — a known mobile-Safari pathology.
**Fix:** the route is **static geometry** — rasterize the trail once per ride into an offscreen canvas in world space, and animate only a repeating-pattern UV offset. Or cap it at **24 chevrons**, spaced along the *visible* portion only, culled to the viewport.

**D3. Six simultaneous wayfinding systems is both a frame budget and a comprehension problem.**
Candy Trail + pinned arrow + light column + screen-edge marker + audio ping + firefly + camera zoom-out, all at once, is visual noise a 6-year-old cannot parse.
**Fix:** **two at a time by default** — pinned arrow + destination beacon. The Candy Trail appears only when the Lost Helper triggers (and then it *is* the helper; delete the separate firefly).

**D4. Unbudgeted particle systems.** Rain, snow, coin fountains (up to 30 passengers × coins), trails, dust rings, confetti bursts.
**Fix:** one global pool, hard cap **200 live particles**, oldest-evicted. Rain and snow are a **pre-rendered tiling pattern scrolled by an offset**, not per-drop draws. Coin fountains cap at 12 sprites regardless of group size.

**D5. "Rainbow road" during Rush implies a per-frame full-screen recolor.**
**Fix:** pre-render a rainbow variant of the cached road layer at district load; Rush swaps the layer and translates a gradient overlay. Zero per-frame path work.

**D6. "Animals wander the road" (Farm & Zoo) adds moving AI agents with pathing and collision — and the collision behaviour is undefined.** If hitting one is a penalty it violates A1.
**Fix:** ≤8 animals per district, waypoint-following (no pathfinding), **pass-through collision** — they bounce comically, honk, and award +1 happy star.

---

## E. Internal contradictions (consolidated)

1. §2.2 formula vs printed ladders (A1 above).
2. A5 "readable numbers" vs 15,000 vehicles / 82,000 depot / 99,999 cap.
3. A2 "no purchase can be wrong" vs the Piggy Bank, and vs per-vehicle 800-coin hats on a vehicle the child outgrows in 8 minutes.
4. A1 "nothing is ever lost" vs `weightClass` accel loss, robot accel penalty, grandma's failable conditional.
5. §3.2 `payout` formula has no golden-route term; §8.16 defines `min(rush + golden − 1, 5.0)`. Two payout formulas.
6. §3.4 income excludes tips and Rush, which §3.2/§5.5 make mandatory.
7. §4.4 P(oversize)=0.25 vs §3.4 group means.
8. §2.3 "speed and controllability must rise together" vs Grip as a separate optional purchase.
9. §4.3 `maxWaitingGroups = 1` at tier 1 vs §4.5 "never despawn" — the single waiting group can end up 15 blocks away permanently while the child wanders. **Fix:** minimum 2 groups, and relocate a group (poof + reappear closer) if the player is >8 blocks away for >10 s.
10. §7 "no number in this document may appear in engine code" vs §2.3's `visualSpeedGain = 1 + 0.06 × max(0, turboLevel − 6)`, §2.4's `ceil(seats/3)`, §8.9's `assert cheapestPurchasableItem.cost <= 30`. Put all three in config.
11. Ice-cream van passive: §1.3 says 0.6 c/s, §3.4 credits "+10.3" over a 20.3 s cycle (should be 12.2). Reconcile and state the movement duty-cycle assumption.
12. §3.5 assumes 45% of income goes to upgrades+cosmetics. Total income to the rocket bus ≈ 78,450; vehicles consume 43,150 (55%), leaving ~35,300 — which is the upgrade total (34,450) **plus 850 for the entire 15,000-coin cosmetic catalog**. The kid who does what §3.6 tells them to do (paint at 0:35, hat at 6:00) falls off the pacing curve immediately.
**Fix:** cosmetics must not compete with the vehicle ladder for the same currency. Cosmetics are bought with **stickers/tickets** (earned per day and per mission), or every cosmetic is a flat trivial 25 coins. A 6-year-old will buy 30 hats before a bus; the economy must be robust to that, not merely assume it away.

---

## F. Missing essentials

1. **Traffic.** A transportation game with zero mention of other vehicles on the road. Decide and state it: v1 has ambient cars that are pass-through and bounce comically; no hostile traffic, no crashes, ever.
2. **Collision response.** What happens when the child drives into a building at full speed? Undefined, and it happens in the first 15 seconds of play. Spec: soft push-out with a squash-and-stretch bounce, a "boing," zero speed penalty beyond the physical stop, no damage state.
3. **Drop-off arrival condition.** Must the child stop on the pad? At 6 they cannot. Spec: **pad entry at any speed = arrival**; the vehicle auto-decelerates through the dwell and auto-resumes.
4. **PWA / offline.** GitHub Pages + a tablet + a car trip with no wifi. A manifest + service worker is free, mandatory for this audience, and completely absent. Also add `apple-touch-icon` and standalone display so it lives on the home screen like a real app.
5. **Save profiles.** The doc names "sibling" as a corruption risk and then ships one save. Three slots, chosen by animal avatar, no text.
6. **Parent gate.** Settings contains `easySteering`, `brakeAssist`, and volume — all of which a child will toggle off and then be unable to restore, plus there's no protected reset. Spec: settings and reset live behind a 3-second press-and-hold on a moving target (not arithmetic — parents on a tablet want it fast).
7. **Pause / backgrounding.** Auto-pause on `visibilitychange`, save, resume with a 3-2-1 tap-through.
8. **The shop's own onboarding.** The purchase script begins at 0:35 with no account of how a non-reader learns that coins buy things. Spec a forced guided first purchase: shop button pulses, one item highlighted, everything else dimmed and non-interactive.
9. **Partial-day exit.** "One more day then bed" only works near a boundary. Award a star for ≥4 deliveries via a "finish now" button on the pause screen.
10. **Adaptive assist.** Nothing responds to a struggling child. Spec: 3 Lost Helper triggers in one session permanently raises pickup radius ×1.3 and steer-assist +20% (silently, never announced, never reversed).
11. **Audio budget.** 12 engine voices + 6 horns + 10 passenger voices + per-district procedural music + an adaptive band layer, with no voice-stealing cap and no mention of the iOS "unlock AudioContext on first touch" requirement. Spec: max 8 concurrent voices with priority stealing, one music graph with crossfades, hard unlock gate on first pointerdown.
12. **Terminal state.** After the depot and the trophies, state explicitly what the game is: endless Golden Routes + sticker book completion + free play in any district with any vehicle. Say it, so nobody builds a cliff.
13. **Privacy.** One line worth writing down: the game makes **zero network requests after load** — no analytics, no fonts, no telemetry. It is a children's product and it should be able to say so.

---

## G. Genuinely strong — preserve these verbatim

1. **A1/A2 anti-regret axioms and the `economy.ts` engineering contract comment.** The whole document's best decision. Keep the comment literally.
2. **Account-wide stat upgrades, per-vehicle cosmetics.** The anti-orphan rule is exactly right and eliminates a whole class of tears.
3. **Fare uses `distanceMatrix[origin][dest]`, fixed at spawn, never the odometer.** Correct, non-negotiable, and stated with the right force.
4. **`n^0.85` sublinear carpool.** Bigger is visibly better without the curve exploding. Keep the exponent.
5. **Leftover passengers stay at the stop, cheering and waving.** The single best idea in the document: the entire "buy a bigger vehicle" argument delivered wordlessly to a non-reader. Build this first.
6. **A3 — new vehicle = new verb, not new number** — and the tuk-tuk deliberately keeping 3 seats to prove it.
7. **The tram removing steering as an accessibility/rest vehicle.** Underrated and genuinely excellent. Ship a road-based version of this idea in v1 (an "easy loop" auto-drive mode) even if the tram itself slips.
8. **The Balloon as a sticker-bought calm toy** — "I'm tired but still want to play" is a real need nobody designs for.
9. **The §4.5 assist stack:** generous radius, magnet walk, horn-as-summon (turning the most-pressed button into a mechanic), approach brake assist, zero patience.
10. **Day = 8 deliveries as an honest parent off-ramp**, plus the "end after this day" toggle. Best product decision in the doc.
11. **The balance validator in CI emitting a designer-readable CSV.** Keep it — but feed it measured data (A6), or it validates nothing.
12. **Migrations never wipe; snapshot to `save.backup` and rebuild best-effort preserving coins, vehicles, stickers.**
13. **Icon-only missions with a free daily reroll.**
14. **The contract that every weather and time-of-day modifier is ≥ 1.0.** Write it into the validator as a hard assert.