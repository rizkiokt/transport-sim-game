# Child UX & Game Feel Specification
### Transportation Simulator — target player: 6 years old, tablet-first

---

## 0. Design pillars

Four rules that resolve every downstream argument. If a feature conflicts with one of these, the feature is wrong.

1. **The finger is the car.** One continuous, positional input. No abstraction layers between what the hand does and what the car does.
2. **Nothing is ever taken away.** Coins, passengers, vehicles, time, and progress only ever go up. The only subtraction in the game is a voluntary purchase, and it always returns a visible object.
3. **Every touch produces a reaction inside 33 ms.** Including touches on nothing. The world must feel alive under the hand.
4. **If it needs a sentence, it's cut.** Not "reworded" — cut, or turned into an animation.

**Feel target, one sentence:** *a heavy toy car being pulled around a soft, bouncy tabletop city by a magnet, where everything you brush against squeaks and everything you deliver pays in a shower of coins.*

**Reference viewport:** 1180 × 820 CSS px (iPad 10.9 landscape). Define `UNIT = clamp(viewportHeight / 820, 0.80, 1.50)`. All pixel values below are at `UNIT = 1` and scale by `UNIT`. All world measurements are in meters; camera default shows **28 m of world height**, i.e. **29.3 px/m**.

---

## 1. Control scheme

### 1.1 The proposal: "Follow My Finger" — positional leash steering

**The car continuously drives toward wherever the finger is on screen.** Angle to the finger sets steering. Distance to the finger sets throttle. There is no stick, no button, no throttle control, and no visible UI widget for driving.

The mental model a 6-year-old already owns: *walking a puppy on a leash*, or *pushing a toy car with your hand*. It takes zero seconds to explain and zero seconds to relearn after a week away.

Critically, **all four input devices collapse into one abstraction**: an *intent vector* in car-relative space.

```
Intent = { angle: -180°..+180° (0 = straight ahead), magnitude: 0..1 }
```

Touch, mouse, keyboard, and gamepad each produce this vector. The driving model consumes only this. One code path, one feel, no per-device tuning drift.

### 1.2 Camera decision (this is a control decision, not a rendering one)

**Heading-up camera: the car always points up the screen.** The world rotates under it.

This is non-negotiable for this audience. With a world-up (fixed-north) camera, when the car drives down the screen, dragging the finger left steers the car *right* visually. Adults context-switch on this in ~200 ms. Six-year-olds do not do it at all — they stall, oversteer, and quit. Heading-up makes "finger on the left half = go left" true 100% of the time, forever.

Motion-sickness mitigation, since heading-up cameras are the usual culprit:
- Top-down orthographic only. **No horizon, no pitch, no 3D chase cam.** Vection sickness is overwhelmingly driven by a moving horizon line; there isn't one.
- Camera heading *lags* car heading: critically damped spring, ω = 4.5 rad/s, ζ = 1.0.
- Hard cap on camera angular velocity: **90°/s** (45°/s in Reduced Motion).
- Camera does not rotate when speed < 0.8 m/s (prevents spinning while parked).
- No roll, no rotational shake, ever.

**Constant-lookahead zoom rule:** the camera zooms out with speed so that the player always sees **≈2.0 seconds of road ahead**. `viewHeight_m = clamp(speed * 2.0 / 0.62, 28, 38)`, lerped at 600 ms. This means a faster upgraded car feels *faster* but is never *harder to read*. Speed upgrades therefore never degrade competence — essential when the reward for playing is a faster car.

### 1.3 Exact input mappings

#### Touch (primary)

| Property | Value |
|---|---|
| Active area | Entire canvas. No dedicated stick zone. |
| Steering pointer | The **first** pointer down on the canvas (tracked by `pointerId`). It keeps ownership until `pointerup`/`pointercancel`. |
| Additional pointers | Do **not** steer. They fire HUD buttons, or trigger the horn if they land on empty canvas. |
| Palm rejection | Ignore pointers with `radiusX > 60` or `radiusY > 60` when available; ignore pointers that begin within 30 px of a screen edge. |
| Angle | `angle = signedAngle(carForward_screen, fingerPos - carScreenPos)`, clamped to ±80° for the steering target. |
| "Finger behind the car" | If \|raw angle\| > 120°: hold last steering sign, `magnitude → 0.30`. The car slows and arcs gently. **It never reverses and never spins.** This is the brake, discovered by accident within the first minute. |
| Dead zone | Radius 70 px around the car's screen position: hold current heading, `magnitude = 0.40`. Prevents jitter when the finger sits on the car. |
| Throttle | `magnitude = smoothstep(70 px, 260 px, distance)` mapped to `0.40 → 1.00`. Beyond 260 px = full speed. |
| Re-acquire | Lift and re-place = instant control, no ramp, no penalty. |
| Latency budget | pointer event → visible steering change ≤ **33 ms** (2 frames). |

**Release behavior (the "coast" state)** — this matters more than it sounds, because 6-year-olds lift their finger constantly to point at things, scratch their nose, or show a parent:

| Time since release | Behavior |
|---|---|
| 0 – 4.0 s | Car keeps its lane, holds heading, decays to 45% speed. Does not turn at junctions — goes straight through. |
| 4.0 – 6.0 s | Glides to a stop over 1.2 s (ease-out). Car "yawns": headlights dim, a small z-z-z particle, one soft sleepy note. |
| > 6.0 s | Parked. Fully safe. Passengers wait forever. World ambient continues (birds, traffic) so the screen never looks dead. |

Touching at any point resumes instantly. **Nothing is ever lost by putting the tablet down.**

**Visible affordance — the leash.** A soft dotted line from the car's nose to the finger, plus an 88 px glowing ring under the finger. Full opacity (0.55 alpha) for the first 3 minutes of play, then fades to 0.18. It is later an unlockable cosmetic (rainbow leash, bubble trail, paw prints) — turning the tutorial affordance into a collectible is free retention.

#### Mouse (desktop)

Identical to touch. `pointerdown` + drag = leash. Additionally: **hover-drive** — if the pointer is over the canvas with no button held for > 0.6 s, the leash engages at 70% magnitude. Desktop users (usually a parent demoing, or an older sibling) find this immediately.

Click on a road or junction = a **nudge**: the car's junction-assist prefers that exit for the next 6 s. This absorbs option (a) — tap-a-destination — as a convenience layer rather than the core scheme.

#### Keyboard (desktop fallback)

Keyboard writes `Intent` directly rather than moving a virtual finger — it's cleaner and matches expectations.

| Key | Action |
|---|---|
| `←` / `A` | `angle → -55°`, ramped at 260°/s |
| `→` / `D` | `angle → +55°`, ramped at 260°/s |
| `↑` / `W` | `magnitude → 1.0` |
| `↓` / `S` | `magnitude → 0.15` (slow), hold 1.2 s to fully stop |
| no key | `magnitude → 0.55`, `angle → 0` (coast straight; same as touch release) |
| `Space` | Horn |
| `Esc` / `P` | Pause |
| `Enter` | Confirm in menus (also: hold 500 ms to buy) |
| Tab | **Disabled** on the canvas. Focus never leaves the game surface. |

#### Gamepad

The most direct mapping of all — the left stick *is* the finger.

| Control | Action |
|---|---|
| Left stick | `angle = stickAngle` (clamped ±80°), `magnitude = clamp(stickLength, 0, 1)` mapped to 0.40–1.00. Radial dead zone 0.18. |
| Right trigger | Optional additive throttle, `+0.25 * value`. Not required to play. |
| `A` / cross | Horn |
| `B` / circle, `Start` | Pause |
| D-pad | Menu navigation; `A` = hold-to-buy |
| Rumble | Gamepad Haptics API, see §6.4 |

### 1.4 Defense against the alternatives

| Scheme | Why it loses |
|---|---|
| **(a) Tap destination, auto-drive** | Deletes the core verb. The child's fantasy is *"I am driving,"* not *"I am dispatching."* Also requires reading a map/plan abstraction that many 6-year-olds lack. Kept as a *nudge* layer and as hint escalation L5. |
| **(b) Virtual thumbstick, fixed position** | Fixed sticks require the thumb to find and stay on an invisible origin; kids drift off it constantly and then the car stops responding with no visible cause — the single most rage-inducing failure mode in kids' touch games. A *dynamic* stick fixes the drift but reintroduces the relative-displacement abstraction ("it matters where I first pressed"), which is strictly harder than "the car comes to my finger." |
| **(c) Hold-to-go + steer** | Two simultaneous inputs, two thumbs, on a device a 6-year-old is often holding one-handed or resting on their knees. Hold-to-go is a dead-man's switch: every accidental lift stops the car. Rejected. |
| **(d) Arrow keys / WASD with car physics** | Fine on desktop (retained as fallback), unusable as the primary scheme on the primary device. Discrete on/off steering also produces the classic 6-year-old oversteer wobble. |
| **(e) Rails, pick turns at junctions** | Genuinely good for accessibility and it survives — but as **Steer Assist Level 3**, not as the whole game. Pure rails removes the moment-to-moment agency that makes the toy fun (bumping into things, doing donuts in the park, chasing a duck). We get rails' benefit by *implementing rails inside the junction assist* while free steering everywhere else. |

**Ergonomics check.** The leash scheme requires no fixed UI at the bottom of the screen, so hand occlusion has no cost: the child's hand covers world, not controls, and the constant-lookahead camera keeps the interesting world *above* the car, away from the hand. Left- and right-handed players are equally served with zero configuration. A child holding the tablet in both hands can steer with either thumb by reaching only ~35% toward the center.

### 1.5 Steering assist — three levels, auto-selected, invisible

The child never sees this menu. The game measures competence and steps down. Parents can pin a level behind the gate.

| | **L3 "Magnet"** (default, first ~10 min) | **L2 "Helper"** | **L1 "Free"** |
|---|---|---|---|
| Lateral pull to road centerline | 4.5 m/s² | 2.0 m/s² | 0.6 m/s² |
| Can leave the road? | No — soft rubber band at road edge | Yes, but pulled back hard | Yes |
| Junction turn | Committed spline, executed perfectly from a 25° flick | Assisted arc, 60% correction | Manual |
| Auto-slow near junction | to 60% within 5 m | to 75% within 4 m | none |
| Off-road speed | n/a | 60% | 70% |

**Promotion rule:** step down one level when, over a rolling 90 s window, off-road time < 4%, junction-intent success > 80%, and mean lateral error < 0.9 m. **Demotion rule:** step up one level immediately on 3 wall bumps within 10 s, or > 25% off-road time over 30 s. Hysteresis: minimum 120 s between changes. Never announce a change — competence should feel like the child's, not the game's.

The **junction turn assist is the highest-value piece of code in this document.** It converts "steer a car around a corner" (genuinely hard motor skill) into "point which way you want to go" (trivial). Implementation intent: within a junction's radius, sample valid outgoing roads; if the intent angle is within 45° of one and \|angle\| > 25°, commit to a Catmull-Rom spline onto that road's centerline over the turn, blending player influence at (1 − assistWeight). The flick is *honored*, never overridden — the child feels they turned the car.

### 1.6 Collisions and off-road: what actually happens

**There is no damage model. There is no crash. There is no `health` field in the codebase.**

| Event | Response |
|---|---|
| **Building / wall / lamppost** | Soft bumper. Speed → 25% (not 0), impulse pushes the car back along the surface normal + tangent (so it *slides along* walls rather than sticking). Car squashes to 0.85× along the impact axis for 90 ms, overshoots to 1.08×, settles over 180 ms (ease-out-back). "Boing" — a 220 Hz detuned sine with a fast pitch drop, 140 ms. Dust puff, 6 particles. Camera punch 3 px, 120 ms. Haptic 12 ms. Object reacts: lampposts wobble, awnings flap, a window shutter pops open and a cat looks out. |
| **Off-road (grass/plaza)** | Speed → 60%. Continuous soft crunch loop (filtered noise), grass-blade particles from the wheels, tire tracks that fade over 8 s. Lateral magnetism toward the nearest road centerline (see assist table). *This is fun, not punished* — grass shortcuts across a park should sometimes be genuinely faster. |
| **Water / map edge** | Invisible rubber-band boundary with 1.5 m of give, eases the car back. A duck paddles over and quacks. The child will do this twenty times. That's fine. |
| **NPC vehicle** | NPCs run *polite AI*: if the player is within 12 m of their forward cone, they brake, pull aside, and toot. On contact: mutual soft bounce, both cars spin-wobble 15°, a comedy "meep-meep", the NPC does an exaggerated shrug animation, a heart particle. **No coin reward** — bumping must stay a toy, not a strategy. Fares pay 25–60× more than any bump interaction, so the efficient path is always the intended path. |
| **Pedestrian / animal** | Cannot be hit. At 3 m they hop aside with a squeak and a small heart. Honking makes them wave, dance, or (dogs) chase the car for 4 s. |
| **Geometrically stuck** (speed < 0.4 m/s for 2.5 s with non-zero intent) | Auto-unstick: car does a 0.5 s hop with a cartoon "sproing", lands aligned to the nearest road centerline facing the objective. Sparkle burst. Reads as a magic trick, not a rescue. |
| **Traffic lights** | Always turn green as the player approaches (within 12 m), with a rising two-note chime and a small sparkle. A red light the player must wait at does not exist. The lights are a *reward generator disguised as an obstacle*. |

---

## 2. Driving feel constants

These are starting values, tuned to be readable and toy-like rather than realistic. They belong in a single `tuning.ts` with no magic numbers scattered elsewhere.

| Parameter | Taxi (start) | Notes |
|---|---|---|
| Car length / width | 4.2 m / 1.9 m | ≈123 × 56 px at default zoom — chunky and readable |
| Top speed | 8.5 m/s (249 px/s) | crosses the screen in ~3.3 s |
| Acceleration | 6.0 m/s² | 0 → top in 1.4 s |
| Braking | 10.0 m/s² | |
| Max yaw rate | 150°/s at ≤2 m/s, tapering linearly to 70°/s at top speed | turn radius at speed ≈ 7 m; city blocks are 44 m |
| Steering smoothing | first-order lag, τ = 90 ms, plus rate limit 6 units/s | removes 6-year-old hand jitter without feeling mushy |
| Lateral grip | high; slide only above 0.85 of max lateral force | drifting is a *cosmetic* at high speed, never a loss of control |
| Camera follow | critically damped spring, ω = 6.0, ζ = 1.0 | |
| Camera lookahead | `velocity × 0.55 s`, clamped to 6 m | |
| Screen shake | max 4 px, only bumps and Tier-4+ rewards; **0 in Reduced Motion** | |
| Car squash/stretch | accelerating: 1.04 × 0.97 over 150 ms; braking: inverse | |
| Sim rate | 60 Hz fixed step (16.667 ms), interpolated render | |

**Block and route geometry** (this is a pacing control, not level design trivia):
- City block: 44 × 44 m → ~5.2 s per block at top speed. **A junction decision every ~5 seconds** is the right cognitive cadence.
- Fare distance: 3–5 blocks, 130–220 m → 16–26 s of driving.
- Full loop (beacon appears → pickup → drive → dropoff → reward): **35–50 s.**
- Coin clusters on roads every ~40 m → a collectible within reach every ~4.7 s.

---

## 3. No-fail design

### 3.1 Failure audit

Every place a naive design introduces punishment, and the replacement.

| Naive failure | Why it's toxic here | Child-safe replacement |
|---|---|---|
| **Crash damage / vehicle destruction** | Loss of a thing the child bought and loves. Guaranteed tears. | Soft bumpers + comedy reactions (§1.6). No health, no repair cost. |
| **Fuel / battery depletion** | An invisible clock the child can't read, ending in forced stop. | **Cut entirely.** No fuel system exists. Optional "Snack Stop" pit stops give a purely additive 20 s speed sparkle — you can ignore them forever. |
| **Fare countdown timer** | Numbers ticking down are the most reliable panic generator in kids' games. | A **bonus star** that *grows* the reward, never shrinks it below base. Star tier 3 → 2 → 1 over 90 s (slow enough that a child who's paying attention almost always gets 3), with a **hard floor at 1**. Framing is always "earn more", never "lose". No digits shown, only 1–3 star pips. |
| **Impatient / angry passengers** | Teaches the child they are disappointing someone. | Passengers have **only degrees of happy**: beaming → content. Angry faces, frowns, tapping feet, and thought-bubble clocks are **banned art assets**. A long wait causes the passenger to sit down, hum, and play with a yo-yo. They wait forever. |
| **Wrong destination** | Being wrong. | Dropoff only triggers at the correct building — it is *impossible* to deliver wrong. Driving to an incorrect landmark triggers a friendly wave animation from that building and nothing else. |
| **Running out of money** | Softlock; nothing to do. | Money **never decreases** except by voluntary purchase. No consumables, no fees, no rent, no repairs, no gambling. Income floor: every dropoff pays ≥ 3 coins regardless of anything. |
| **Getting lost** | Silent, unbounded frustration; the child doesn't know they're stuck. | The escalating hint ladder (§4.2), ending in soft auto-pilot. Never more than 45 s of confusion. |
| **Speeding tickets / police** | Authority punishment. | Do not exist. No sirens, no fines, no chase. |
| **Getting stuck in geometry** | The worst kind of failure: unfair and unexplained. | Auto-unstick hop after 2.5 s (§1.6). |
| **Missing a turn** | | Roads are a graph; every route re-solves instantly and silently. Going the "wrong way" just makes the trip longer, and the road arrow redraws with no comment. |
| **Losing progress on reload/close** | Catastrophic. | Autosave on every dropoff, every purchase, every 15 s, and on `visibilitychange`/`pagehide`. |
| **Being unable to afford something** | Feels like "no". | Locked items are *teases with progress*, never refusals — see §5.4. Nothing plays an error buzzer. Ever. |
| **Timed challenges / races** | Time pressure + a losable outcome. | If races ship later: **everyone finishes and everyone gets a prize**, first place just gets a bigger one. The race ends when the *player* finishes, not when the timer does. |

### 3.2 What creates tension and pacing without failure

Failure is one way to create arousal. It is not the only way, and for this audience it is the worst one. Replacements, in priority order:

1. **Anticipation under uncertainty.** Passengers appear as a wobbling question-mark silhouette that resolves on approach. ~12% are "special" (a dog in a hat, an astronaut, a cake that must not be jostled) and pay 3–5×. Variable ratio reward with zero downside is the strongest engine available.
2. **Proximity crescendo.** The destination beacon's pulse rate rises from 0.8 Hz at 100 m to 2.4 Hz at 10 m, and a rising musical tone layers in over the last 4 seconds. This is *physiological tension* generated purely by approach. It is the single most effective no-fail pacing tool.
3. **Near-miss juice.** Passing within 1.2 m of an obstacle at > 70% speed → "whoosh" (filtered noise sweep), a speed-line flourish, +1 coin. Rewards risk without punishing failure of it.
4. **Filling bars.** At any moment at least one visible bar/ring is filling: the next upgrade's affordability ring, the sticker album, the day meter, the vehicle-under-construction in the garage.
5. **Collection sets with visible holes.** Empty silhouetted slots are more motivating to a 6-year-old than any score.
6. **Escalating spectacle.** 3 seats → 7 → limo → bus is not just a number: it's more passengers cheering at once, a longer vehicle that bends around corners, a horn that gets deeper and funnier, a bigger coin shower.
7. **World state change.** Day → sunset → night → dawn on a ~10 min cycle. Rain that makes puddles. These cost nothing and reset attention.
8. **The toy layer.** Puddles that splash, leaf piles that scatter, a car wash that makes the car sparkle for 30 s, small ramps with a 300 ms slow-motion airtime, a flock of pigeons that erupts on a horn honk. **These must ship in v1.** A 6-year-old who wants to spend ten minutes driving through the same puddle is playing correctly.

---

## 4. Onboarding: 60 seconds, zero reading

### 4.1 First-run beat sheet

No title screen, no menu, no logo, no "tap to start" on the very first run. The app boots directly into the world with the car parked. Total assets on screen at t=0: one road, one car, one passenger, sky.

| t | Beat |
|---|---|
| **0.0 s** | World fades in over 400 ms. Car parked, centered. Camera at 1.15× zoom (close), engine idle rumble. No HUD yet — coin counter, pause, and horn are all hidden. |
| **0.8 s** | Car **wakes up**: headlight eyes blink open (two 120 ms blinks), body does a 1.06× bounce, two-note friendly chime (C5→E5). Establishes "this vehicle is a character" in under a second. |
| **1.5 s** | Camera eases out to 1.0× over 700 ms, revealing one passenger 8 m ahead on the sidewalk, bobbing at 1.1 Hz inside a soft light shaft. |
| **2.2 s** | **Ghost hand** fades in (white, 55% alpha, 96 px, drop shadow) at 62% screen height / 50% width. It presses (scale 0.9 + expanding ring), then slides 90 px right and back over 1.6 s. A dotted leash line draws from the car's nose to the ghost hand. Loop every 2.5 s. |
| **wait** | Nothing else happens. **No timer, no nagging.** At 8 s with no touch: hand scales to 1.2× and a soft "boop" plays. At 16 s: the passenger waves and calls out (a warm two-syllable non-verbal vocalization). At 30 s: the car itself creeps forward 2 m on its own and looks back at the player. |
| **first touch** | Ghost hand vanishes in 1 frame. Engine revs (saw pitch sweep 120→180 Hz, 250 ms), dust puff, car rolls. The child's very first frame of input produces a large, unmistakable reaction. **This gesture is also what unlocks the AudioContext** — no separate audio-permission prompt, ever. |
| **+0.5 s** | A giant chevron decal is painted **on the road surface** pointing at the passenger, scrolling forward at 0.9 m/s. The world does the wayfinding, not the HUD. |
| **~10–18 s** | **Pickup** (auto on proximity < 1.5 m, at any speed, no button). Full Tier-2 stack (§6). Passenger arcs into the car. A portrait pops into the top-center job card — **the HUD is born at the moment it becomes meaningful**, not before. |
| **+0.3 s** | Job card shows the passenger's face plus a thought bubble containing the destination's **icon + color** (e.g. a red ice-cream cone). Simultaneously a giant matching red ice-cream cone sign inflates above the destination building, visible through the edge-of-screen chevron. The road decal repaints toward it. **The child learns "match the shape" in one wordless beat.** |
| **~25–35 s** | **Dropoff.** Full Tier-3 stack. Coin counter flies in from off-screen for the first time and lands in the top-left with a bounce, then ticks up 3 coins with ascending pitch. |
| **~35 s** | Second fare spawns. Route now contains exactly **one junction**. Junction glows, gets road-painted turn arrows, auto-slows to 60%, assist L3 executes the turn from any flick. |
| **~55 s** | Horn button (120 px, bottom-right) slides in with a wobble; a pigeon lands on the road ahead. First honk = pigeon explosion + laugh-inducing flap. Horn is discovered by 100% of children within 15 s of it appearing. |
| **~75–110 s** (after fare 3) | Coin total crosses the first upgrade price (**25 coins**, deliberately tiny). Garage button (96 px, bottom-left) slides in, jiggles every 3 s, and a coin sprite arcs from the counter into it. First tap opens a shop containing **exactly one purchasable item**, centered, huge. Everything else is off-screen. |
| | **From here, the game is fully taught.** Nothing else is introduced in the first session except by discovery. |

**Total elements introduced in 110 s: steering, pickup, destination matching, dropoff, coins, horn, shop.** That is the entire game. Junction turning, assists, and multi-passenger arrive later without ceremony.

### 4.2 Hint escalation ladder

Runs per *objective*, resetting on any meaningful progress (distance to goal decreased by > 8 m). Applies identically to "find the passenger", "find the destination", and "the shop is available".

| Level | Trigger | Behavior |
|---|---|---|
| **L0** | 0–6 s | Nothing. Silence is respect. |
| **L1** | 6 s | Beacon pulse amplitude +50%, single soft ping (E6, 120 ms). |
| **L2** | 12 s | Road-surface chevron decal appears/brightens; breadcrumb dots every 3 m animate along the route at 1.2 m/s. |
| **L3** | 20 s | Ghost hand returns and demonstrates the *specific* needed input (e.g. presses to the left of the car if a left turn is needed). |
| **L4** | 32 s | **Helper bird** launches from the car's roof, flies the route to the goal leaving a glitter trail, circles the goal 3×, returns. Repeats every 12 s. |
| **L5** | 48 s | **Soft auto-pilot.** The car begins driving the route at 55% speed, but the child's intent vector is still blended in at 40% weight, and any touch immediately restores 100% control. The child arrives believing they drove there. Auto-pilot disengages permanently for that objective on the first touch that reduces distance-to-goal. |

Hard rules: **no hint is ever modal. No hint pauses the game. No hint contains text. No hint has a dismiss button.** A hint that requires acknowledgement is a punishment.

---

## 5. Text-free UI language

### 5.1 The rule for every element

> **Every UI element is exactly: a SILHOUETTE-FIRST ICON, optionally a NUMERAL, optionally a COLOR, and optionally a COUNT OF PIPS. Nothing else. No nouns, no verbs, no labels, no tooltips.**

Text permitted in the entire product: **numerals only**, plus the parent area behind the gate. That's it. Not a single child-facing word ships.

Corollary: an icon must be recognizable **as a black silhouette at 48 px**. If it isn't, it's the wrong icon. Test every icon by rendering it solid black at 48 px and showing it to a child.

### 5.2 Icon vocabulary

| Concept | Icon | Notes |
|---|---|---|
| Money | Gold coin, embossed star, thick dark outline | Always paired with a numeral. Always animated on change. |
| Speed | Three stacked chevrons pointing right, plus a speed-line | Never a speedometer arc — dial-reading is not reliable at 6. |
| Seats | **Countable chair pips.** 3 chairs = 3 seats. 7 chairs = 7 seats. | Do not print "7". Print seven chairs. Counting objects is a skill they *have*; symbolic capacity is one they're building. |
| Fare / earnings | Coin with a small upward arc arrow | |
| Handling / grip | Curved arrow with two tire marks | |
| Looks / style | Four-point sparkle | |
| Locked | Padlock over a 25%-alpha silhouette of the actual item | Tease, not denial |
| Owned / equipped | Green circle with a thick checkmark **plus** the item drawn at full color | Never green-only (colorblind) |
| Passenger | Round-headed character bust, unique per character | |
| Destination | A unique **shape** (cone, star, house, ball, tree, fish, moon, drum) with a unique color | Shape + color always, never color alone |
| Sound | Speaker with 0 / 1 / 2 arcs — a **3-state button**, not a slider | Sliders demand fine motor control kids don't have |
| Pause | Two thick vertical bars | Universal, learned from every video app |
| Home / garage | Garage with an open door and a car nose | |
| Day complete | Moon with a nightcap | |

### 5.3 Where numerals are acceptable

A typical 6-year-old reliably recognizes digits 0–20, counts to ~100, and has weak place-value intuition above ~30. Therefore:

**Numerals allowed:**
- Coin total (the digits are exciting even when the magnitude isn't understood — "big number good" is real and fine).
- Prices, **always accompanied by an affordability ring** (below).
- Collection counts, rendered as `[filled dots] 3 / 12` — the dots carry the meaning, the digits are decoration.
- Level / day number, purely as a badge.

**Numerals forbidden:**
- Percentages. A 6-year-old has no model of "+15%".
- Stat values ("Speed: 42"). Use pips.
- Timers of any kind (there are none anyway).
- Anything above 999 in the first several hours. Keep the price curve under 999 for at least the first ~2 hours of play, then render larger totals as `[coin-stack icon] × N` alongside the digits.

### 5.4 Communicating "this costs 250 coins and gives more speed" with no sentences

The shop card, 280 × 340 px, contains exactly five things:

```
┌──────────────────────────────┐
│   [ vehicle / part artwork ] │   ← 180px, rotating slowly on a
│      lit turntable           │      turntable, always in motion
├──────────────────────────────┤
│  speed  ■■■□□  →  ■■■■□      │   ← BEFORE pips solid, the gained
│                    ^pulsing   │      pip pulsing green-outlined
│  seats  [chair][chair][chair] │      at 1.4 Hz
│           + [chair] pulsing   │
├──────────────────────────────┤
│      ◜◝  (coin)  250          │   ← AFFORDABILITY RING:
│      ◟◞   ring 78% filled     │      radial progress = have/cost
└──────────────────────────────┘
```

Three mechanisms carry the entire message with no words:

1. **Before/after pips.** The child sees three solid bars and a fourth outlined bar pulsing. "I get one more of that." This is comprehensible at 4, let alone 6.
2. **The affordability ring.** A radial arc around the price, filled to `min(coins/price, 1)`. This is the key invention: it converts a numeric comparison (do I have enough?) into a **visual fullness judgment**, which is developmentally available years earlier. When the ring completes, the card lights up, the coin turns from gray-flat to gold-glossy, and a soft chime plays *even if the shop is closed* — heard from the world, it pulls the child to the garage.
3. **Motion-as-meaning.** Affordable cards float and breathe (2 px vertical sine, 0.5 Hz). Unaffordable cards sit still and desaturate to 45%. Movement = available. This is preattentive and needs no learning.

**Tapping an unaffordable card must never scold.** It plays a soft wobble (±4°, 260 ms), the affordability ring flashes and animates from 0 → current fill, and 3 ghost coins float up from the ring. Translation: "you need this much more." **No buzzer, no red, no shake, no X, no sound of rejection anywhere in the product.**

### 5.5 Purchase confirmation: hold-to-buy

Kids mis-tap constantly, and a confirm dialog is unreadable and un-dismissable to them. Solution:

**Press and hold the buy button for 500 ms.** A ring fills around the thumb, a tone rises in pitch across the fill, particles converge. Release early = ring drains, nothing happens, no penalty sound. Complete = purchase fires.

This simultaneously prevents accidents, requires no reading, and **is itself an anticipation-and-payoff beat** — the hold builds tension that the purchase celebration releases. Best-in-class pattern for this age. Use it for every irreversible action in the game (which should be a very short list).

### 5.6 Layout, sizes, and touch targets

| Element | Position | Size |
|---|---|---|
| Coin counter | Top-left, 24 px from safe-area inset | Pill 210 × 72 px; coin icon 56 px; digits 48 px tall, weight 800, 3 px dark outline |
| Job card (passenger + destination) | Top-center | 280 × 100 px |
| Pause | Top-right | 88 px circle |
| Garage / shop | Bottom-left | 96 px circle (hidden until first affordable item exists) |
| Horn | Bottom-right | 120 px circle — the biggest button in the game, because it's the most-pressed |
| Off-screen goal indicator | Slides along the screen border | 72 px chevron + destination shape icon |

**Rules:**
- Minimum touch target **88 × 88 px**; primary actions **110 px**. (Apple's 44 pt is an adult minimum; children need roughly 2×.)
- Minimum 32 px spacing between adjacent interactive elements.
- All UI respects `env(safe-area-inset-*)` and stays ≥ 44 px from every physical screen edge (palm rejection zone).
- **The bottom-center 420 × 260 px region contains no HUD** — that's where the steering thumb lives.
- **Mis-tap forgiveness:** buttons commit on `pointerup` within the target *or* within 24 px of it. Pressing produces a 120 ms scale-to-0.92 + ring so the child sees the press registered. Dragging off cancels silently with no sound.
- 250 ms debounce on all purchase and navigation actions.

### 5.7 No minimap (for the first hour, at least)

Minimaps require allocentric spatial reasoning — translating a top-down abstraction to an egocentric view — which is unreliable until roughly age 8. Replace with:
1. Road-surface chevron decals (the world tells you where to go),
2. The edge-of-screen chevron with the destination's shape icon,
3. The proximity beacon crescendo.

A minimap can unlock much later as a *collectible toy* ("the map the duck gives you"), never as required navigation.

---

## 6. Reward and feedback schedule

### 6.1 The Delight Stack

One shared, data-driven component. Five tiers. Every reward in the game is a tier, so nothing is ever under- or over-celebrated by accident.

#### Tier 1 — Micro (target: one every ≤ 8 s)
Road coin, near-miss, puddle splash, traffic light turning green, honk reaction, leaf scatter.
- 0 ms: sample-and-hold pitch tone, 60–90 ms. **Pitch ascends by one semitone per consecutive pickup within 2.5 s of each other, resetting after** — a coin chain becomes a melody. This one detail is responsible for more replay in kids' games than almost anything else.
- 0 ms: 4–8 particles, 350 ms life.
- 40 ms: coin sprite magnets to the counter over 300 ms (ease-in-quad), counter digit rolls.
- No camera effect, no haptic, no pause. **Never interrupts driving.**

#### Tier 2 — Pickup (every 35–50 s)
| t (ms) | Event |
|---|---|
| 0 | "Bloop": sine 660 → 990 Hz over 90 ms. Passenger squashes to 0.8 y. |
| 0–180 | Passenger arcs into the car (ease-out-back, 40 px overshoot); car body squashes 1.10 × 0.92 on their landing. |
| 60 | Expanding ring shockwave, 0 → 140 px, 220 ms, alpha 0.7 → 0. |
| 100 | 3 heart particles, upward drift, 600 ms. |
| 120 | Haptic: 10 ms light. |
| 180 | Portrait slides into the job card with overshoot. |
| 250 | Destination beacon ignites; rising 3-note arpeggio (C-E-G, 90 ms apart). |
| **Total ≤ 600 ms, fully non-blocking. The car never stops.** | |

#### Tier 3 — Dropoff (the core payoff)
| t (ms) | Event |
|---|---|
| 0 | Confetti burst, 24 pieces, gravity + rotation, 1.2 s life. Passenger hops out. |
| 0 | "Ta-da": four-note major arpeggio, 340 ms total. |
| 80–420 | **Coin cascade.** One sprite per coin up to 8 sprites (above 8, sprites carry multiple coins). Staggered 40 ms. Each landing plays a note ascending one semitone. This is the cash-register pleasure and it must be tuned obsessively. |
| 120 | Camera zoom 1.04× for 300 ms (ease-out), returns over 400 ms. |
| 150 | Passenger does a 2-hop dance and waves; a small firework above the building. |
| 160 | Haptic: 18 ms medium. |
| 400 | Counter number rolls up with a tick per digit change. |
| 600 | Next fare beacon appears — **the loop re-arms before the celebration ends**, so there is never a dead moment. |
| **Total ≈ 900 ms. Still non-blocking.** | |

#### Tier 4 — Purchase (the only permitted interruption)
1.6 s, skippable by touch after 300 ms.
- Coins fly *out* of the counter into the vehicle (reverse of the earn animation — closes the loop causally).
- Vehicle spins once on a turntable with a light sweep across its body.
- Rising riser (saw sweep + noise, 900 ms) resolving into a bright major chord.
- Confetti, 60 pieces.
- The changed stat pips fill one at a time, each with an ascending pip sound.
- Ends by dropping the child **straight back into driving with the new vehicle already under them.** No "back to map" screen. No menu step.

#### Tier 5 — New vehicle / district / level (every 15–25 min)
2.5 s max, skippable after 300 ms. Garage door rolls up, light spills out, fireworks, a short 6-second musical sting, the new vehicle drives itself out and does a spin. The child's first input takes control mid-spin.

### 6.2 Cadence targets (design contract)

| Tier | Target interval | Enforcement |
|---|---|---|
| 1 | ≤ 8 s | Content spawner guarantees a collectible within 25 m of the player's route at all times. If > 10 s elapse with no Tier-1, spawn a butterfly/coin/pigeon near the road ahead. **Ship a debug HUD that graphs time-since-last-reward.** |
| 2 & 3 | 35–50 s | Fare distance tuning (§2) |
| 4 | 4–8 min | Price curve tuning (economy lens) |
| 5 | 15–25 min | Progression tuning |

**Build the reward-cadence debug overlay in week one.** It is the single most useful instrument for this project: a rolling graph of reward events by tier over the last 3 minutes, with a red band whenever Tier-1 exceeds 8 s. Tune against the graph, verify with children.

### 6.3 The horn: a first-class reward machine

The horn will be pressed several hundred times per session. Treat it as a feature, not a toy.
- Every press guarantees a reaction from the nearest reactive entity within 15 m: pigeons erupt, a dog barks back (with a *different* bark each time — 5 variants, randomized), a pedestrian waves, a shop awning flaps, a car toots back.
- Pitch varies ±3 semitones per press, and **three presses within 1.2 s trigger a little musical flourish** rather than three identical honks. This is what stops honk-spam from becoming acoustically unbearable to the parent in the room.
- Rate limit: max 4 audible honks per 2 s; excess presses still produce the visual reaction (never a dead press).
- Each vehicle tier has a distinctly funnier horn. The bus's horn is a comedy air-horn. This is a legitimate purchase motivation for a 6-year-old and should be shown in the shop card as an animated sound-wave icon that plays on tap.

### 6.4 Haptics

| Platform | Approach |
|---|---|
| Android / Chrome | `navigator.vibrate()` — 10 ms (Tier 1–2), 18 ms (Tier 3), `[20, 40, 20]` (Tier 4) |
| iOS Safari | No vibration API. Substitute a **60 Hz sine "thump", 40 ms, low-passed, at 0.35 gain** — a tactile-feeling audio cue that reads as impact through tablet speakers. |
| Gamepad | Gamepad Haptics `playEffect('dual-rumble')`, weak 0.3 / 60 ms for bumps, 0.6 / 140 ms for Tier 4 |
| Setting | On by default; single toggle in the parent area; forced off in Reduced Motion |

---

## 7. Session shape

### 7.1 Minute-by-minute

**Minute 0–1 — "I'm driving."**
Cold open, hands on the car within 6 s, first pickup by ~15 s, first coins by ~30 s, three fares complete by ~90 s. Content on screen is deliberately sparse: one road loop, no traffic, no junctions until 35 s. Success metric: **the child never asks an adult what to do.**

**Minute 1–5 — "I'm earning."**
5–8 fares. Junctions, road coins, horn, first animal, first puddle. First purchase lands at **3–4 minutes** (price 25, then 60) — the first upgrade must arrive before a 6-year-old's patience budget expires, which is roughly 4 minutes. Make the first two upgrades *visually loud* (a paint color and a roof light bar) rather than statistically meaningful. Visible change > numerical change at this age.

**Minute 5–15 — "I'm collecting."**
- ~8–12 min: **the 7-seater unlocks.** This is the session's emotional peak and must be a Tier-5 event.
- Multi-passenger fares begin: 2 passengers at once, each with their own shape/color destination, free dropoff order. This is the first real *thinking* the game asks for, introduced only after 8 minutes of pure competence-building.
- A second district unlocks (different palette, different landmarks, a river with a bridge). Novelty resets attention right as the first district's is fading.
- A sticker/photo is collected and slots into the album with a satisfying thunk.

**Minute 15+ — free play.** By now the child has their own goals. The game's job is to stay out of the way and keep the Tier-1 carpet dense.

### 7.2 Ending gracefully

The most important and most neglected part of a children's game. Getting a tablet taken away mid-play is the #1 source of tears, and it is a UX problem, not a parenting problem.

**Three mechanisms, all shipping:**

1. **The Day Cycle (automatic, every ~10 min).** Over 40 s the sky sweeps to sunset, streetlights flick on one by one, ambient traffic thins, and a soft "winding down" music layer fades in. Then a moon icon appears on the pause screen. If the child keeps playing, dawn arrives and nothing is lost. **This gives the parent a natural, visible, non-arbitrary handle: "let's stop when the sun goes down."** A finishable-looking unit of play is worth more than any timer.

2. **The Goodnight button (child-initiated).** On the pause screen, a large moon button. Tapping it drives the car home *automatically* — the child watches their own car drive into the garage, headlights sweeping, door rolling down — then shows the day's haul (coins earned as a stack, passengers carried as a row of faces, stickers found). Then a 4-second lullaby and a still garage scene. **Letting the child choose to end is the whole trick.** Children who quit on their own terms don't melt down; children who are interrupted do.

3. **The Parent Session Timer (optional, behind the gate).** Settable to 10/15/20/30 min. It never shows a countdown to the child. At T−2 min the sunset begins early. At T−30 s a gentle "coming home" musical motif. At T=0 the car auto-drives home and the Goodnight sequence plays. **There is no lockout screen, no "time's up", no red text, no disabled controls.** After the sequence, the garage scene simply stays — the child can look at their collection, tap their vehicles, but the drive button is a sleeping moon. Zero confrontation.

### 7.3 Bringing them back tomorrow

Permitted (all purely additive):
- **A wrapped gift box in the garage**, one per real-world calendar day. Contains coins or a cosmetic. Visible, wrapped, and *shakeable* (tap it, it rattles) the day before it's ready.
- **A vehicle under construction.** A visible work-in-progress car in the garage bay that advances a stage each session. Deep anticipation, zero pressure.
- **The sticker album with empty silhouetted slots.** Always the first thing shown on the garage screen.
- **A teased character.** One passenger silhouette in the album that hasn't been met yet.
- **Streaks that only ever increase and never reset.** A "days played" counter that goes up and never goes down. Missing a week costs nothing.

**Explicitly forbidden:** energy/stamina, lives, "come back in 4 hours" timers, streak loss, daily quests that expire, timed limited offers, push-notification guilt, anything that makes a 6-year-old feel they've let the game down.

---

## 8. Accessibility & parent controls

### 8.1 Colorblind safety

- **No information is ever carried by color alone.** Every destination has a unique *shape* as well as a color; every state (owned/locked/affordable) has an icon and a motion state as well as a hue.
- Primary contrast axis is **blue ↔ orange**, not red ↔ green. Reserve red/green adjacency for purely decorative scenery.
- Verify the full palette under deuteranopia, protanopia, and tritanopia simulation. Requirement: **any two semantically distinct colors must remain distinguishable under all three simulations**, or they must additionally differ in luminance by ≥ 25%.
- Icon-on-background contrast ≥ 3:1; numerals ≥ 4.5:1; all HUD numerals get a 3 px dark outline so they survive any background.

### 8.2 Reduced motion (`prefers-reduced-motion: reduce`)

Do **not** strip feedback — children depend on it more than adults. Change its *kind*:
- Camera shake → 0. Camera rotation cap → 45°/s. Camera zoom pulses → 0.
- Particle counts × 0.35; particle speeds × 0.6.
- Parallax layers → static.
- Full-screen flashes → removed entirely.
- Retain: scale/squash animations, color pops, all audio, coin magnets, counter rolls.

### 8.3 Photosensitivity

Hard rule, enforced by a lint-able constant: **no full-screen luminance change greater than 10% may occur more than 3 times per second**, and no flash sequence may exceed 3 Hz. This covers fireworks, level-ups, and lightning. Cap and audit centrally in the renderer, not per-effect.

### 8.4 Audio

- **Never autoplay.** The AudioContext is unlocked by the first steering touch (§4.1) — elegant, invisible, and policy-compliant.
- One big 3-state speaker button (loud / quiet / off), reachable from pause in one tap. **Not a slider.** Persisted.
- Default master 0.65. Separate music/SFX sliders exist only behind the parent gate.
- Duck to 0 on `visibilitychange` (a kid switching apps must not blast audio from the background).
- **Dynamic range discipline:** hard-limit the master bus. A 6-year-old will trigger 40 simultaneous events; the output must never spike. Cap simultaneous voices at 16, with per-sound-type voice stealing.
- Every sound must be *pleasant on the 500th repetition* — that's the honk, the coin, and the bump. Vary pitch on all three.

### 8.5 Parent gate

Required before: reset save, settings that could confuse, any external link, and the session timer. Must be genuinely resistant to a 6-year-old but trivial for an adult.

**Recommended gate:** display three numbers **spelled as words** — "SEVEN · TWO · NINE" — and a keypad of digits. The parent taps 7, 2, 9. This defeats a non-reader completely while costing an adult two seconds. It requires no PIN storage, no email, and no account.

Combine with a 3-second press-and-hold to enter the gate at all, so it can't be reached by mashing.

**Reset save additionally requires:** the gate, *then* a hold-to-confirm of 2000 ms with a filling ring, *then* a 5-second undo window. Losing a 6-year-old's garage is the worst outcome this product can produce.

### 8.6 Rage-quit trigger blacklist

Every one of these has caused a documented meltdown in this category:
- Modal dialogs the child can't dismiss or read.
- Any state where touching the screen does nothing for > 500 ms.
- Losing control of the vehicle for > 2 s (all cutscenes skippable after 300 ms).
- Any negative sound: buzzers, "wrong" tones, descending minor thirds, sad trombones.
- Red X marks, frowning faces, crossed-out icons.
- Targets under 88 px.
- Double-confirmation dialogs.
- Progress loss on reload, crash, or backgrounding.
- Camera whip, sudden zoom, or rotation over 90°/s.
- A tutorial that blocks input until the "correct" thing is done.

### 8.7 Platform hygiene (tablet)

Set on the canvas and body:
- `touch-action: none` (kills double-tap zoom and pan)
- `overscroll-behavior: none` (kills pull-to-refresh mid-drive — an *extremely* common accidental progress-wipe on tablets)
- `user-select: none`, `-webkit-touch-callout: none` (kills long-press context menu and text selection)
- `-webkit-tap-highlight-color: transparent`
- Offer fullscreen on the first user gesture; do not force it.
- In the parent area, describe Guided Access (iOS) and Screen Pinning (Android) — the single most useful thing a parent can be told.
- Auto-pause on `visibilitychange` and `blur`; on resume, a **3-dot non-numeric "ready" pulse** (three dots extinguish over 900 ms) before control returns, so the child isn't dropped mid-corner.

---

## 9. Anti-patterns: engineer's review checklist

Review every PR against this list. Any "yes" is a blocker.

**Failure and punishment**
- [ ] Does any code path decrease `coins` other than a completed voluntary purchase?
- [ ] Does any entity have `health`, `damage`, `fuel`, `durability`, or `lives`?
- [ ] Does any timer count *down* toward a worse outcome?
- [ ] Can a passenger ever leave, refuse, or express displeasure?
- [ ] Does any sound descend in pitch, use a minor interval to signal a result, or resemble a buzzer?
- [ ] Does any art asset contain a frowning face, an angry face, a red X, or a "no" symbol?
- [ ] Can the player reach a state where nothing is affordable and nothing is achievable?
- [ ] Is there any race, challenge, or minigame the player can lose?

**Text and reading**
- [ ] Does any child-facing string contain a character that is not a digit?
- [ ] Is any icon unrecognizable as a solid black silhouette at 48 px?
- [ ] Does any UI use a percentage, a unit, or an abbreviation?
- [ ] Is any information carried by color alone?

**Input and control**
- [ ] Is any interactive target smaller than 88 × 88 px, or closer than 32 px to a neighbor?
- [ ] Is there any HUD element inside the bottom-center 420 × 260 px steering zone?
- [ ] Does any input require two simultaneous touches?
- [ ] Does any input depend on where a drag *began* rather than where the finger *is*?
- [ ] Can a second/third touch (palm, sibling, stray finger) disturb steering?
- [ ] Does any touch anywhere fail to produce a visible response within 33 ms?
- [ ] Does releasing the finger ever produce a bad outcome?

**Flow and interruption**
- [ ] Does any reward, hint, or tutorial pause the simulation?
- [ ] Is there any modal the child cannot dismiss with one large tap?
- [ ] Is any cutscene or celebration longer than 2.5 s or unskippable after 300 ms?
- [ ] Does the game ever take control of the car for more than 2 s without the child having stopped inputting?
- [ ] Does any hint contain a sentence, or require acknowledgement?

**Persistence and safety**
- [ ] Can progress be lost by reload, backgrounding, crash, or pull-to-refresh?
- [ ] Is any destructive action reachable without the parent gate + hold-to-confirm + undo window?
- [ ] Does audio ever play before a user gesture, or continue when backgrounded?
- [ ] Can the master audio bus clip when 20 events fire simultaneously?

**Dark patterns (categorically forbidden in a children's product)**
- [ ] Any advertising, of any kind, including cross-promotion.
- [ ] Any purchase flow, real-money or simulated-currency-purchasable.
- [ ] Any external link not behind the parent gate.
- [ ] Any analytics that identifies a child, or any data leaving the device.
- [ ] Any streak, energy, cooldown, or expiring offer that punishes absence.
- [ ] Any social feature, leaderboard, or comparison to other players.

---

## 10. Playtest acceptance criteria

Measurable, testable with 8–10 children aged 5–7, no adult instruction permitted.

| # | Criterion | Target |
|---|---|---|
| 1 | Time from app open to first deliberate steering input | median ≤ 8 s, 90th pct ≤ 20 s |
| 2 | First successful dropoff, unaided | ≥ 8/10 children within 90 s |
| 3 | Number of children who ask an adult "what do I do?" in the first 3 min | ≤ 1/10 |
| 4 | Time-since-last-reward, 95th percentile, over a 10 min session | ≤ 8 s |
| 5 | First upgrade purchased, unaided | ≥ 8/10 within 6 min |
| 6 | Observed frustration events (sigh, hand-off to adult, verbal complaint, screen-push) | ≤ 1 per 10 min session |
| 7 | Children who correctly match a destination by shape/color without being told | ≥ 9/10 by the third fare |
| 8 | Children who voluntarily use the Goodnight button when asked to stop | ≥ 6/10 |
| 9 | Unprompted return the next day (parent-reported, 1 week) | ≥ 5/10 on ≥ 4 of 7 days |
| 10 | Steady-state frame rate on a 2019 iPad / low-end Chromebook | ≥ 58 fps, with < 1% frames over 20 ms |

---

## 11. Handoff: what the engine must expose for this layer

Short list so the other lenses can build against it.

- `Intent { angle: number, magnitude: number }` — the single input abstraction. Every device driver produces this; the vehicle model consumes only this.
- `AssistLevel` (1–3) with the parameters in §1.5, plus a `CompetenceTracker` emitting the rolling metrics (off-road %, junction success, lateral RMS).
- `DelightStack.play(tier, worldPos, opts)` — a single data-driven entry point for every reward. All timings in §6.1 live in one table, not scattered across call sites.
- `RewardCadenceMonitor` — tracks time since last Tier-1 event; content spawner subscribes to guarantee the ≤ 8 s carpet. Ships with a debug overlay.
- `HintLadder(objectiveId)` — owns the L0–L5 escalation and resets on progress. Nothing else in the codebase may show a hint.
- `Icon` registry keyed by semantic concept, with a mandatory 48 px black-silhouette snapshot test.
- `Motion` service reading `prefers-reduced-motion` and exposing `shakeScale`, `particleScale`, `rotationCap`, `flashAllowed` — every effect must read from it rather than checking the media query itself.
- `ParentGate.require(reason): Promise<boolean>` — the only route to destructive or configuration actions.
- `AudioBus` with a hard limiter, 16-voice cap, per-type voice stealing, and pitch-variation helpers.