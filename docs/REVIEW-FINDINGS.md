# Code review findings

An adversarial multi-lens review of the 3D build (2026-07-31). Four reviewer
agents — correctness, child-UX, performance, architecture — raised 32
findings; each was then handed to an independent skeptic told to *refute* it.
17 survived.

This file records what was fixed and, more importantly, what was not.

> **A caveat on provenance.** The review harness reported that its safety
> classifier was unavailable while several of these agents ran. Every finding
> below that is marked *verified* was re-checked by hand against the code
> before being acted on. The outstanding ones have **not** been independently
> re-verified — treat them as leads, not facts, and confirm before fixing.

## Fixed

| Severity | Area | Defect |
| --- | --- | --- |
| Critical | Audio | The in-game mute button never muted. `#toggleMute` updated `SettingsManager`, the save and the HUD icon, but nothing called `AudioBus.setMuted`. The title-screen mute worked only because it called the bus directly, and a page reload re-applied the persisted flag — so the button appeared to work. Fixed by adding a single `settings.events.on('changed', ...)` subscription in `main.ts` that applies to every consumer. |
| Critical | Driving | A car nosed into a building was a hard softlock. Steering authority is proportional to speed and a head-on collision pins speed to ~0, so holding the throttle and turning could not rotate the car at all. The only escape was reverse — on touch, an undiscoverable downward drag. The car now regains pivot authority after pressing against something for 0.35s. |
| Critical | Touch | Two ways to latch the throttle at full, permanently: a lost `pointerup` (broken capture, OS gesture, lost focus) left the car driving itself and rejected every later finger; and first-pointer-wins let a resting palm take driving control. Fixed with window-level release fallbacks plus blur/visibilitychange, and by letting the newest deliberate touch take over. |
| Major | Economy | `VehicleDef.fareMultiplier` was declared on all six vehicles and read nowhere, so every vehicle paid the same fare. Buying the 1500-coin bus made the car slower for no extra pay — an anti-reward in a game whose core rule is never to punish. |
| Major | Rendering | The quality tier was snapshotted at construction, so the adaptive watchdog only half-applied: pixel ratio and draw distance moved, but shadows, IBL, fog range, particle density and shake stayed frozen. A downgrade kept the costs it was meant to remove *and* pulled the far plane in without the fog, cutting geometry off in clear air. |
| Major | Accessibility | `reducedMotion` and quality preference were never persisted, so the two settings a parent sets for a motion-sensitive child reset on every reload. Save schema v3. |
| Major | Rides | Pickup radius (3.6) barely exceeded the sidewalk offset (3.33), so a car in the far lane sat ~6 units away and sailed past silently — and nothing tells a child which side to drive on. Radii widened to cover the full road. The waiting passenger also now gets the same beacon the destination has; a 1-unit figure among 8-unit buildings previously had no marker at all. |

Regression tests were added for the mute path, the softlock (both that it
escapes and that the aid never becomes spin-on-the-spot), and the pickup
geometry.

## Outstanding

Ordered by what I would tackle first. None are crashes.

### 1. Garage logic is duplicated, with divergent behaviour

`main.ts` and `TownScene3D` each implement buy/select and save import/export
— once against the raw save object, once through the scene. The title-screen
copy exists because there is no car to swap before the town is built, which
is a real constraint, but the two copies can and will drift. This is the one
most likely to produce a bug that is hard to trace.

*Suggested shape:* a single `Fleet` module owning buy/select/persist, which
both callers drive; the scene subscribes to it for the model swap.

### 2. `#importSave` does not apply the imported `activeVehicle`

Importing a save rebuilds upgrades, coins, mute and ride count, but leaves
the player driving whatever they were driving, and does not refresh the
garage. The car and the save that describes it disagree until the next
reload.

### 3. Ride positions come from `cosmeticRng`

`rng.ts` explicitly reserves that generator for "effects that are purely
cosmetic and never persisted". Passenger and destination placement is
gameplay state. It works today, but it is exactly the kind of documented
invariant that quietly becomes false.

### 4. Nothing teaches a non-reader how to drive

The touch stick only materialises *after* the first press, so the single
gesture the whole game depends on has no affordance. A first-run hint —
a ghost hand, or the stick shown idle until first use — would fix it.

### 5. Child-facing UI contains English text and an OS file picker

"Save to file" / "Load file" sit inside the upgrade shop, which is the
child's screen. The picker is a modal dead end for a non-reader, and can
silently replace all their progress. These are parent controls and belong
behind the title-screen settings sheet, which already has them.

### 6. Two quality-tier state machines

`SettingsManager` (`TIER_PROFILES`, `guessInitialTier`) and `ThreeRenderer`
(`RENDER_PROFILES`, `guessTier`) both probe the device and both hold a tier.
They can disagree. One should own it.

## Notes on the review itself

Two things worth remembering for next time.

**Findings go stale against a moving codebase.** One lens reported the shared
character-geometry pool as dead code. It was correct when it read the file
and wrong by the time it reported — the fix landed mid-review. Always
re-check against `HEAD`.

**The skeptic pass earned its keep in precision, not just filtering.** It
confirmed 17 of 32, but it also *corrected* several of the confirmations it
upheld: it downgraded the mute bug from critical to major (no crash, no data
loss, title mute works, reload recovers it), and it caught that the
"expensive vehicles are strict downgrades" claim held for the van, truck and
bus but not the sports car or limo, which are faster than the taxi. The
sharper claim is the useful one.
