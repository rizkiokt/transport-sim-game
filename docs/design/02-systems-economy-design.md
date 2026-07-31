# Systems, Economy & Progression Spec — "Happy Wheels Transit Co."

*Lens: game systems, content and progression. Everything below is data, not code — see §7 for the schema all of it lives in.*

---

## 0. Five design axioms (every number below derives from these)

| # | Axiom | Consequence |
|---|---|---|
| A1 | **Nothing is ever lost.** No fuel, no repairs, no fines, no timers, no expiring passengers, no negative balance, no "game over". | Softlock is structurally impossible. There is no failure state to design around. |
| A2 | **No purchase can be wrong.** Every stat upgrade is account-wide and permanent; every vehicle stays drivable forever; cosmetics are cheap and per-vehicle. Nothing is mutually exclusive; everything is eventually affordable. | Removes the entire class of "I wasted my money" tears. |
| A3 | **New vehicle = new verb, not new number.** Each rung changes *how you move* or *who rides with you*. | Stat scaling is deliberately mild (×1.38/tier); the *feel* delta carries the reward. |
| A4 | **Two reward channels, two pacers.** Coins pace the ladder; ⭐Stars gate content so a fast kid can't skip the world. Stars are set to ~65% of expected earn rate — they almost never block, but they stop a rusher. | Content unlocks feel earned, not bought. |
| A5 | **Numbers stay readable.** Wallet never exceeds 5 digits in normal play; ≥1,000 is displayed as gold bars + coins. | A 6-year-old can read every number on screen. |

---

## 1. The vehicle roster (12 rungs)

### 1.1 Feel-first summary

| T | Vehicle | The new **verb** | The child's fantasy |
|---|---|---|---|
| 1 | 🚕 **Pip** the Taxi | Drive & pick up | "I have a job!" |
| 2 | 🛺 **Zippy** the Tuk-Tuk | *Go fast & tilt* | "I'm the zoomiest" |
| 3 | 🍦 **Sprinkles** the Ice-Cream Van | *Play music that summons a crowd* | "Everyone runs to ME" |
| 4 | 🚐 **Bertha** the Family Van | *Carry a whole family at once* | "Nobody gets left behind" |
| 5 | 🚘 **Gloria** the Limo | *Bendy body, red carpet, VIPs* | "I drive famous people" |
| 6 | 🛻 **Chomp** the Monster Truck | *Drive over everything — shortcuts* | "Rules don't apply to me" |
| 7 | 🚌 **Buster** the School Bus | *Big honk, a dozen cheering kids* | "I'm in charge of the whole class" |
| 8 | 🚋 **Ding** the Tram | *Rails steer for you — one-finger play* | "I'm a real city driver" (and: rest) |
| 9 | ⛴️ **Splashy** the Ferry | *Leave the road entirely — water* | "A new world opened" |
| 10 | ✈️ **Jetty** the Plane | *Take off — fly over the map* | "I can go ANYWHERE" |
| 11 | 🚀 **Blastoff** the Rocket Bus | *Low gravity, floaty arcs, the Moon* | "I beat the game… on the Moon" |
| 12 | 🎈 **Puff** the Balloon | *No collisions, no steering stress, drift* | Reward toy: "my calm favourite" |

### 1.2 Full stat table (seed values — these are the balance source of truth)

Units: **1 world unit (wu) ≈ 1 metre. 1 block = 20 wu.** Speed is wu/s.

| T | id | Seats | Speed | Accel | Turn °/s | Grip | fareMult | Locomotion | routeEff* | Dwell pick/drop | Unlock cost | ⭐gate |
|---|----|-------|-------|-------|----------|------|----------|-----------|-----------|-----------------|-------------|-------|
| 1 | `taxi` | 3 | 9 | 14 | 150 | 0.90 | 1.00 | road | 0.60 | 1.2 / 2.0 | — (start) | 0 |
| 2 | `tuktuk` | 3 | 13 | 22 | 200 | 0.72 | 1.00 | road | 0.60 | 1.2 / 2.0 | **300** | 3 |
| 3 | `icecream` | 5 | 8 | 10 | 130 | 0.95 | 1.20 | road | 0.60 | 1.2 / 2.0 | **500** | 7 |
| 4 | `van` | 7 | 11 | 12 | 130 | 0.92 | 1.05 | road | 0.62 | 1.4 / 1.8 | **750** | 10 |
| 5 | `limo` | 8 | 11 | 10 | 105 | 0.88 | 1.00 | road (bendy) | 0.62 | 1.6 / 1.6 | **1,200** | 13 |
| 6 | `monster` | 6 | 13 | 18 | 140 | 0.80 | 1.30 | road+offroad | **0.85** | 1.2 / 2.0 | **1,900** | 17 |
| 7 | `schoolbus` | 12 | 11 | 9 | 100 | 0.90 | 1.40 | road | 0.62 | 1.8 / 1.4 | **2,900** | 23 |
| 8 | `tram` | 16 | 15 | 8 | rails | 1.00 | 1.15 | rail | 0.95 (×1.4 path) | 2.2 / 2.3 | **4,400** | 27 |
| 9 | `ferry` | 20 | 16 | 7 | 70 | 0.55 | 1.00 | water | 0.90 | 2.0 / 2.0 | **6,600** | 33 |
| 10 | `plane` | 24 | 26 | 12 | 85 | 0.75 | 1.00 | air | 0.95 | 3.0 / 3.0 (+takeoff) | **9,600** | 41 |
| 11 | `rocketbus` | 30 | 34 | 9 | 75 | 0.45 | 0.95 | space | 0.95 | 4.0 / 4.0 | **15,000** | 50 |
| 12 | `balloon` | 8 | 6 | 4 | 60 | 1.00 | **3.00** | float | 1.00 | 2.0 / 2.0 | **🏷 30 stickers** (0 coins) | — |

\* `routeEff` = fraction of top speed actually realised by a 6-year-old driver over a route (wandering, turns, walls). It is a **content constant per locomotion type**, used by the economy validator, not by the sim.

### 1.3 Per-vehicle detail

**T1 🚕 Pip the Taxi** — Round yellow bubble, two big eyes in the windshield, eyebrows that raise on pickup. *Fantasy:* the first job. *Design job:* teach drive → glow-pad → passenger pops in → arrow → drop → coins. Handling is deliberately the most forgiving in the game (grip 0.90, turn 150°/s) so a first-time driver can't spin out.

**T2 🛺 Zippy the Tuk-Tuk** — Lime-green three-wheeler, comically small, leans hard into turns, engine goes *put-put-put-BRAAP*. Same 3 seats as the taxi — **this is intentional**: the second purchase must teach "vehicles feel different", not "vehicles have bigger numbers". +44% speed, lower grip, a visible body-tilt of up to 18°. It is cheap (300) because its whole job is to arrive fast, at ~4:30, and prove the shop is worth visiting.

**T3 🍦 Sprinkles the Ice-Cream Van** — Pastel pink/mint, giant cone on the roof, plays a 6-note loop. **New verb:** while moving, the jingle earns **0.6 coins/sec** and pulls waiting passengers toward the road (summon radius +6 wu). Slowest vehicle so far (8 wu/s) — the trade is legible even to a non-reader: *slow but everyone loves me*. Passenger mix shifts to `kid`/`family` (bigger groups, more tips).

**T4 🚐 Bertha the Family Van** — Boxy teal minivan, sliding door with a satisfying *shunk*, seven seat-windows that light up one by one as people board. **The 7-seat moment.** This is the first time a full spawn group fits, and the game should stage it: the tutorial-adjacent "Family Day" mission spawns a 7-person group the very first day you own it.

**T5 🚘 Gloria the Limo** — Long, glossy, articulated: the rear half trails the front on a hinge and swings out visibly on turns. **New verb + new *who*:** owning the limo flips 30% of spawns to `vip` passengers (sunglasses, tiny dog, fare ×1.8) and adds a red-carpet roll-out animation at drop-off. Its richness comes from *who rides*, not a hidden multiplier — that's readable.

**T6 🛻 Chomp the Monster Truck** — Purple, four fat tyres, a grille shaped like a mouth. **New verb: the map stops mattering.** Drives over kerbs, grass, planters, hedges, roundabouts; squashes cones with a *boing*; bounces on landing. Its economy edge is `routeEff 0.85` — it earns more because *shortcuts are real*, which a child directly perceives ("I go straight through!"). Only 6 seats — again, never a pure upward stat line.

**T7 🚌 Buster the School Bus** — Classic yellow, stop-sign arm that flips out, 12 windows full of waving kids, a deep two-tone honk. Owning it enables `schoolRun` group spawns (8–12 kids, one destination). The drop-off is a full-screen cheer.

**T8 🚋 Ding the Tram** — Cream-and-red, overhead pole with a sparking wire, a brass bell. **New verb: steering is removed.** The kid holds one big pedal to go and releases to stop; the rails do the rest. This is the single most important accessibility unlock in the game — it is the vehicle a tired or overwhelmed child will choose, and the one a 4-year-old sibling can play. Rails add a 1.4× path-length penalty (you can't cut corners), which is why it doesn't break the curve.

**T9 ⛴️ Splashy the Ferry** — Chunky blue-and-white boat with a smokestack that puffs rings; bow wake and a bobbing idle. Unlocks the **Harbour district** — a whole new map. Loose grip (0.55) so it drifts, which is *fun* on open water where there is nothing to hit.

**T10 ✈️ Jetty the Plane** — Fat cartoon propeller plane with a smiling nose cone. Take-off is a 3-second scripted rise with a camera pull-back that reveals the whole map from above — the biggest single "wow" beat in the game. Unlocks **Sky Islands**.

**T11 🚀 Blastoff the Rocket Bus** — A school bus with fins and three rocket nozzles. Low-gravity handling: long floaty arcs, slow-motion landings, dust rings. Unlocks the **Moon**.

**T12 🎈 Puff the Balloon** — Rainbow envelope, wicker basket, tiny burner. Not on the coin ladder — bought with **30 stickers**. Zero collision, 6 wu/s, fare ×3.0 so it earns about the same as a mid-tier vehicle. It exists so that "I'm tired but I still want to play" has an answer.

---

## 2. Upgrade system

### 2.1 The core decision: **account-wide stats, per-vehicle looks**

- **Stat upgrades are company-wide ("Garage" tab).** Buying Turbo 5 upgrades *every vehicle you own, forever, including ones you buy later.* This is the load-bearing anti-regret rule (A2). A kid can never orphan an investment by buying a new bus.
- **Cosmetics are per-vehicle ("Paint Shop" tab).** Paint, hats, decals, wheels, trails. Cheap (25–2,000). Per-vehicle is *correct* here because it's self-expression, and re-buying a hat for the bus is a feature, not a tax.
- **There are no per-vehicle stat upgrades at all.** Zero. This also removes an entire UI screen from a non-reader's mental model.

### 2.2 Tracks

| Track | Icon | Levels | Effect per level | Max effect | Base cost `B` | Growth `G` | Track total |
|---|---|---|---|---|---|---|---|
| Turbo (speed) | ⚡ | 10 | `+4%` base speed | +40% | 25 | 1.75 | 8,935 |
| Comfort (fare) | 💺 | 10 | `+7%` fare | +70% | 35 | 1.75 | 12,210 |
| Grip (handling) | 🎯 | 8 | `+6%` turn rate, `+5%` steer-assist | +48% / +40% | 20 | 1.70 | 1,975 |
| Extra Seat | 🪑 | 4 | `+1` seat (capped, see 2.4) | +4 | 250 | 2.40 | 5,800 |
| Horn | 📣 | 6 | new sound **+2 wu summon radius** | +12 wu | flat: 40/80/150/300/600/1200 | — | 2,370 |
| Lights | 💡 | 5 | night vision radius +8 wu, +3% night tip | +40 wu | flat: 60/150/350/800/1800 | — | 3,160 |
| **Total** | | **43 levels** | | | | | **34,450** |

**Cost formula (one function, used by every track):**

```
cost(track, L) = round5( track.baseCost * track.growth^(L-1) )     // L = 1..maxLevel
round5(x) = Math.round(x / 5) * 5                                  // all prices end in 0 or 5
```

Turbo actual ladder: **25, 45, 75, 135, 235, 410, 715, 1255, 2195, 3845**
Comfort actual ladder: **35, 60, 105, 185, 320, 560, 980, 1715, 3000, 5250**
Grip actual ladder: **20, 35, 60, 100, 165, 285, 485, 825**
Seats actual ladder: **250, 600, 1450, 3500**

Note `G = 1.75` per upgrade level vs `1.38` income growth per vehicle tier. Upgrades therefore get *relatively* more expensive as you progress — that is the primary inflation brake (§3.5).

### 2.3 Why the effects are small

Max Turbo is only +40% because a 6-year-old at +100% speed cannot steer. Grip levels also raise **steer-assist** (the auto-correct that nudges you back to road centre), so speed and controllability rise together. Beyond Turbo 6 the *perceived* speed is boosted further with motion lines, camera FOV widening, and wind whoosh — visual speed, not physical speed. This is an explicit engineering instruction: `visualSpeedGain = 1 + 0.06 * max(0, turboLevel - 6)` applied to camera/VFX only.

### 2.4 Extra Seat gating (prevents the ladder collapsing)

```
effectiveSeats(vehicle) = vehicle.seats + min(seatUpgradeLevel, vehicle.seatUpgradeCap)
vehicle.seatUpgradeCap = ceil(vehicle.seats / 3)     // taxi:1  van:3  bus:4  rocket:4 (hard cap 4)
```
Plus: **seat level L is only purchasable once you own `L+1` distinct vehicles.** So a kid cannot bolt 4 seats onto the taxi and skip the van. Elegant, invisible, and expressed purely in data.

### 2.5 Anti-regret checklist (design contract)

1. No sell button, no downgrade, no consumables, no ammo, no rentals.
2. One spendable currency. Stars and stickers cannot be spent (they only unlock).
3. Every price is visible next to a coin pile the child can compare to their wallet; unaffordable items are greyed but never hidden (aspiration is the point).
4. Purchases ≥ 2,000 show a **picture confirm** (big vehicle art, thumbs-up / thumbs-down, no text). Under 2,000: instant, one tap, no confirm.
5. Cosmetics are always cheap enough that "I bought a hat instead of Turbo" costs < 1 minute of play.
6. **7-second undo** on any purchase (a shrinking coin icon in the corner, tap to refund). Silently prevents mis-taps without ever creating a strategy.

---

## 3. Economy math

### 3.1 Constants (`economy.json`)

```
BASE_FARE        = 6        // coins, flat per passenger
DIST_RATE        = 4.5      // coins per block of graph distance
BLOCK            = 20       // wu
CARPOOL_EXP      = 0.85     // group total = perPax * n^0.85
TIP_STEP         = 0.05     // per happy-star, max 3
RUSH_MULT        = 2.0      // Rainbow Rush
DAY_LENGTH       = 8        // deliveries per in-game day
TIER_INCOME_RATIO= 1.38     // validator target
```

### 3.2 Fare formula

```
perPassenger = (BASE_FARE + DIST_RATE * d_blocks)
             * vehicle.fareMult
             * (1 + 0.07 * comfortLevel)
             * passengerType.fareMult
             * district.fareMult

rideTotal    = perPassenger * (n ^ CARPOOL_EXP)          // n = passengers dropped together
tip          = round(rideTotal * TIP_STEP * happyStars)  // happyStars 0..3, always ≥ 0
payout       = ceil(rideTotal + tip) * (rushActive ? RUSH_MULT : 1)
```

**`d_blocks` is the precomputed graph distance between the pickup Stop and destination Stop — never the odometer.** This is the single most important anti-exploit line in the document (§8.1).

Why `n^0.85` instead of a linear group bonus: linear group bonuses compound with seat counts and blow the curve to ×1.8/tier by the ferry. `n^0.85` keeps total rising with every extra passenger (so "bigger is better" is still true and visible) while holding the ladder to ×1.38.

| n | 1 | 2 | 3 | 5 | 7 | 12 | 16 | 20 | 30 |
|---|---|---|---|---|---|----|----|----|----|
| `n^0.85` | 1.00 | 1.80 | 2.55 | 4.00 | 5.24 | 8.32 | 10.6 | 12.9 | 18.4 |

**Happy stars** (all opt-in, all positive — never a penalty):
- ⭐ honked while the passenger was boarding
- ⭐ drove through a floating coin/balloon pickup during the ride
- ⭐ hit a boost pad or did a jump during the ride

### 3.3 Cycle-time model (used to derive income)

```
cycle = ((approach_blocks + d_blocks) * BLOCK) / (speed * (1+0.04*turbo) * routeEff)
      + dwellPickup + dwellDropoff
incomePerMin = (rideTotal / cycle) * 60   [+ vehicle trickle]
```

### 3.4 Derived income & pacing table (base upgrades = 0)

| T | Vehicle | band `d` | approach | avg group `G` | perPax | cycle s | coins/ride | **coins/min** | ratio |
|---|---------|----------|----------|---------------|--------|---------|-----------|---------------|-------|
| 1 | taxi | 2.0 | 1.5 | 1.7 | 15.0 | 16.2 | 23.6 | **87** | — |
| 2 | tuktuk | 2.5 | 1.5 | 1.8 | 17.3 | 13.5 | 28.5 | **127** | 1.46 |
| 3 | icecream | 2.5 | 1.6 | 2.8 | 20.7 | 20.3 | 49.7 +10.3 music | **177** | 1.39 |
| 4 | van | 3.5 | 2.0 | 4.2 | 22.8 | 19.3 | 77.3 | **240** | 1.36 |
| 5 | limo | 4.0 | 2.0 | 5.5 | 24.0×1.24 vip | 20.8 | 126.7 | **365** | 1.52 |
| 6 | monster | 4.0 | 2.0 | 4.6 | 31.2 | 14.1 | 114.2 | **487** | 1.33 |
| 7 | schoolbus | 4.5 | 2.2 | 9.5 | 36.8 | 22.9 | 249.2 | **654** | 1.34 |
| 8 | tram | 5.0 | 2.0 | 12.0 | 32.8 | 18.3 | 271.1 | **891** | 1.36 |
| 9 | ferry | 5.5 | 2.2 | 14.0 | 30.8 | 14.7 | 290.1 | **1,183** | 1.33 |
| 10 | plane | 7.0 | 2.5 | 17.0 | 37.5 | 15.7 | 416.6 | **1,593** | 1.35 |
| 11 | rocketbus | 8.0 | 2.5 | 22.0 | 39.9 | 14.5 | 551.9 | **2,284** | 1.43 |

Every ratio sits in **[1.33, 1.52]** — the validator (§7.6) asserts `[1.25, 1.55]`.

### 3.5 Time-to-unlock

Assume the player runs at `R × 1.35` (typical upgrade level for that stage) and spends **~45%** of income on upgrades/cosmetics. Progress toward the next vehicle therefore accrues at `R × 1.35 × 0.55 ≈ R × 0.74`.

| Tier you're in | R | Next vehicle | Cost | **Minutes in tier** | Rides in tier | Cumulative min | Cumulative rides |
|---|---|---|---|---|---|---|---|
| 1 taxi | 87 | tuktuk | 300 | **4.7** | 17 | 4.7 | 17 |
| 2 tuktuk | 127 | icecream | 500 | **5.3** | 24 | 10.0 | 41 |
| 3 icecream | 177 | van | 750 | **5.7** | 17 | 15.7 | 58 |
| 4 van | 240 | limo | 1,200 | **6.8** | 21 | 22.5 | 79 |
| 5 limo | 365 | monster | 1,900 | **7.0** | 20 | 29.5 | 99 |
| 6 monster | 487 | schoolbus | 2,900 | **8.0** | 34 | 37.5 | 133 |
| 7 schoolbus | 654 | tram | 4,400 | **9.1** | 24 | 46.6 | 157 |
| 8 tram | 891 | ferry | 6,600 | **10.0** | 33 | 56.6 | 190 |
| 9 ferry | 1,183 | plane | 9,600 | **11.0** | 45 | 67.6 | 235 |
| 10 plane | 1,593 | rocketbus | 15,000 | **12.7** | 49 | 80.3 | 284 |
| 11 rocketbus | 2,284 | *(endgame sinks)* | — | — | — | — | — |

**Total ≈ 80 minutes of efficient play, 284 rides, to reach the Rocket Bus.**
Apply a **dawdle factor of 1.8–2.5×** for a real 6-year-old (they honk, they drive in circles, they visit the paint shop) → **145–200 minutes of wall-clock play ≈ 15–20 sessions ≈ 3–4 weeks** at 2–3 sessions a week. That is before any of the §6 long tail.

### 3.6 First-ten-minutes purchase script (the cadence proof)

| Clock | Wallet | What they can buy | Purchase # |
|---|---|---|---|
| 0:00 | 0 | — | tutorial ride |
| 0:35 | 24 | 🎨 Paint (25) | **1** |
| 1:10 | 55 | 📣 Horn 1 (40) | **2** |
| 1:45 | 85 | ⚡ Turbo 1 (25) + 💺 Comfort 1 (35) | **3, 4** |
| 2:30 | 130 | 🎯 Grip 1 (20), ⚡ Turbo 2 (45) | **5, 6** |
| 3:20 | 175 | 💺 Comfort 2 (60) | **7** |
| 4:40 | 310 | 🛺 **TUK-TUK (300)** 🎉 | **8** |
| 6:00 | 130 | 🎩 Hat (100) | **9** |
| 7:15 | 250 | ⚡ Turbo 3 (75), 💺 Comfort 3 (105) | **10, 11** |
| 9:30 | 400 | 📣 Horn 2 (80), 🎯 Grip 2 (35) | **12, 13** |

Something to buy every **35–90 seconds** in the first 10 minutes; a **vehicle** every 5–13 minutes. Target met.

### 3.7 Inflation control (six mechanisms)

1. **Curve discipline.** Income ×1.38/tier; upgrade costs ×1.75/level. Upgrades always outrun income, so "one more Turbo level" stays a real decision at every stage.
2. **The Depot** (endgame sink, unlocks ⭐55). A company yard you decorate: 24 items at 300–12,000 (fountain, car wash, statue of your taxi, trophy shelf, mascot, fireworks tower). **Total ≈ 82,000 coins.** Vehicles are shown parked in it and stickers are displayed on the wall — so it's a *display case*, which is the strongest long-tail motivator for this age.
3. **Golden Route contracts** (endgame). 3 per day, marked with a gold shine, pay `×3–5` and use `d = 8–12 blocks`. Keeps the top-end loop exciting without adding a digit.
4. **Cosmetic catalog that grows.** Paint 25–150 (24 colours), hats 100–800 (30), decals 50–600 (40), wheels 150–900 (8), trails 400–2,000 (10). ≈ 15,000 coins, ×12 vehicles for the per-vehicle items.
5. **Piggy Bank.** Any time the wallet exceeds 10,000, a piggy appears offering to swap **10,000 coins → 1 🏆 Trophy** (a shelf collectible, purely cosmetic, up to 12). This is an *optional* sink that keeps the wallet under 5 digits and turns "too much money" into a collectible. Never forced.
6. **Display compression.** `< 1,000` → `🪙 340`. `≥ 1,000` → `🏅3 🪙 240` (1 bar = 1,000). Wallet is hard-capped at 99,999 with a "piggy is full!" nudge — a cap that is unreachable if the player engages with any sink.

---

## 4. Ride generation

### 4.1 World model

Each district is a graph of **Stops** (~24 per district) placed on the road/rail/water network, each with a big glowing pad, a canopy, and an idle animation. `distanceMatrix[a][b]` (graph distance in blocks) is precomputed at load — the fare uses this, never the odometer.

### 4.2 Distance bands

| Band | blocks | Used by tiers |
|---|---|---|
| A "Hop" | 1.5 – 2.5 | 1–2 |
| B "Short" | 2.0 – 3.5 | 3–4 |
| C "Medium" | 3.0 – 5.0 | 5–7 |
| D "Long" | 4.5 – 7.0 | 8–10 |
| E "Epic" | 6.0 – 10.0 | 11 |

Destination pick: `candidates = stops where distanceMatrix[origin][s] ∈ band`; choose the one that is **most visually distinct** (different colour landmark than the origin) to aid memory; tie-break random. There is a **hard floor**: destination is never the origin stop and never < 1.2 blocks away.

### 4.3 Spawn rules

```
maxWaitingGroups = clamp(1 + floor(tier / 2), 1, 4)
groupSize = clamp( round( sampleTriangular(mix.min, mix.mean, mix.max) ), 1, 30 )
```
- Groups spawn at the Stop **nearest the player but not the one they're standing on**, biased to 2–5 blocks away so there's always something to drive toward.
- Passengers **never despawn and never lose patience.** A waiting group idles forever (they play, they dance, they wave harder the longer they wait).
- The `passengerMix` on the *current vehicle* biases who spawns (limo → VIPs, ice-cream van → kids, bus → school groups). This is how vehicles change the *content*, not just the numbers.

### 4.4 Multi-passenger logic — the simplest rule that works

> **A group spawns at ONE stop and shares ONE destination.**

- All members board simultaneously (one approach, one animation, one *pop-pop-pop*).
- All members alight simultaneously in a coin fountain.
- `boarded = min(groupSize, freeSeats)`. **Leftovers stay at the stop, cheering and waving — never sad.** This is the entire "buy a bigger vehicle" argument delivered without a single word of text: *"Only 3 of the 7 puppies fit. The others are still waiting."*
- **~25% of groups are deliberately larger than your current vehicle** (`P(groupSize > seats) ≈ 0.25` by tuning `mix.max`), so the aspiration is always fresh but never the norm.

**Extra Riders (unlocks at tier 4).** Up to 2 *solo* passengers may be picked up mid-route, each with their own destination and their own coloured arrow (matching the colour of their hat). Cap of 2 keeps the number of simultaneous arrows at 3, which is the ceiling for this age group.

### 4.5 "The kid drives past the passenger"

Layered, all on by default, all in `assist.json`:

1. **Generous pickup radius:** 3.5 wu, scaled ×1.4 while `speed < 40%` of max.
2. **Magnet walk:** within 8 wu the group runs toward the vehicle (they do the last bit of driving for you).
3. **Horn summon:** honking pulls anyone within `10 + 2×hornLevel` wu straight at you, arms up. Turns the most-pressed button into a mechanic.
4. **Approach brake assist:** within 8 wu of the active target and closing, speed is softly capped at 60% of max. Overshooting becomes hard without ever taking control away.
5. **Zero patience timer.** Driving past costs nothing but time. Loop around; they're delighted you came back.

### 4.6 "The kid forgets where to go"

1. **Candy Trail** — a dotted, animated, scrolling path drawn *on the road surface* from the vehicle to the target, in the passenger's hat colour. Not a minimap line: the actual road, glowing.
2. **Pinned arrow** — a big chevron attached to the vehicle, colour-matched, with the distance shown as a shrinking pie (not a number).
3. **Destination beacon** — a vertical light column visible over buildings, plus a screen-edge marker when off-screen.
4. **Audio ping** — a soft bell whose tempo increases as you approach. Non-verbal wayfinding for a non-reader.
5. **Lost Helper** — after 20 s with no net progress toward the target, a friendly firefly spawns and flies the route ahead of you at your speed. If it happens twice in one ride, the Candy Trail thickens and the camera briefly zooms out to frame both you and the destination.
6. **The map is small.** Districts are sized so that the longest band-appropriate route is ≤ 25 s at that tier's speed.

---

## 5. Progression gates, stars, and the day cycle

### 5.1 Three currencies, three jobs

| | Earned by | Spent on | Can it be lost? |
|---|---|---|---|
| 🪙 **Coins** | Fares, tips | Vehicles, upgrades, cosmetics, depot | Never (only spent) |
| ⭐ **Stars** | Day completion (1) + missions (0–2) | Nothing — they *unlock* content | Never |
| 🏷 **Stickers** | One-time "first time you…" events | Nothing — they fill the Sticker Book; 30 buys the Balloon | Never |

### 5.2 The day cycle

**A day = 8 deliveries.** (~3–5 minutes — exactly one attention span.)

At day end, the **Day Report** takes over the screen:
1. Vehicle drives in from the left and parks.
2. Coin counter ticks up with an ascending arpeggio (the single most reinforcing moment in the game — make it 2.5 s and don't let anyone skip it).
3. Passengers delivered, shown as a row of tiny character heads.
4. ⭐ awarded: 1 for completing the day, +1 per mission cleared (max 3/day, avg **2.2**).
5. A stamp thuds onto a paper calendar. Calendar is a screen you can revisit.
6. Weather / time-of-day rolls for the next day.
7. One giant green **NEXT DAY ▶** button.

The Day Report is also the **parent's off-ramp** — "one more day then bed" is a bounded, honest promise. Add a small clock-icon "🌙 End after this day" toggle a parent can flick.

### 5.3 Missions (the star faucet)

3 active at a time, drawn from a pool of ~40. **All icon-and-number, zero sentences.** Reroll one per day for free (a dice button).

Examples: `[👤×10]` carry 10 passengers · `[📣×15]` honk 15 times · `[🐶]` deliver a dog · `[🏁 20]` drive 20 blocks · `[🪑 full]` fill every seat once · `[🏖️]` visit the beach · `[⭐×3]` earn 3 happy-stars on one ride · `[🍦×5]` sell 5 ice creams · `[🌙]` complete a night ride · `[🎂]` deliver a birthday party.

Difficulty scales with tier so a mission is always ~1 day of play.

### 5.4 Star gate table

Star gates sit at ~65% of the stars a normal player will have at that moment — they exist to stop skipping, not to grind.

| ⭐ | Unlocks | Expected ⭐ at that point |
|---|---|---|
| 0 | Downtown district, Taxi, Paint Shop | 0 |
| 3 | 🛺 Tuk-Tuk purchasable, Horn track | 4.6 |
| 5 | **Beach district** | 8 |
| 7 | 🍦 Ice-Cream Van, Extra Seat track | 10.7 |
| 10 | 🚐 Van, **special passengers** (dog, robot, birthday) | 15.2 |
| 13 | 🚘 Limo, **day/night cycle + Lights track** | 20.8 |
| 17 | 🛻 Monster Truck, **Farm & Zoo district** | 26.3 |
| 20 | **Weather** (rain, snow), Trails cosmetics | 30 |
| 23 | 🚌 School Bus | 35.7 |
| 27 | 🚋 Tram, **rail network in all districts** | 42.2 |
| 33 | ⛴️ Ferry, **Harbour district** | 51.2 |
| 41 | ✈️ Plane, **Sky Islands district** | 63.6 |
| 50 | 🚀 Rocket Bus, **Moon district** | 77.2 |
| 55 | **The Depot** (decoration endgame) | ~85 |
| — | 🎈 Balloon at **30 stickers** | — |

### 5.5 Celebration moments (deliberately placed)

| When | What happens |
|---|---|
| Every drop-off | Coin fountain, passenger jump, 3-note jingle, screen-shake 3px |
| Every 5th drop-off | The Happy Meter fills → **Rainbow Rush**: 30 s of ×2 coins, rainbow road, faster music |
| Day end | Day Report + calendar stamp |
| New ⭐ level | Confetti burst, level number stamps on screen, +50×level bonus coins |
| **New vehicle** | Full-screen garage reveal: doors open, spotlight, the vehicle does an idle "hello" animation, horn plays, the kid taps to drive it out. **No skip button for 4 s.** |
| New district | Camera flies the whole district in 5 s with new music |
| New sticker | Sticker peels off, spins, sticks itself into the book with a *shk-thump* |
| Plane first take-off | Camera pull-back reveal of the entire map |
| Rocket first launch | 3-2-1 countdown the kid taps through, then the Moon |

---

## 6. Content variety over time (the long tail)

**Districts (6).** Downtown (grid, easy) → Beach (curvy, palms, sand shortcuts for the monster truck) → Farm & Zoo (animals wander the road, animal passengers) → Harbour (water + docks, ferry) → Sky Islands (floating platforms, planes) → Moon (craters, low gravity, domes). Each district ships its own `passengerMix`, `fareMult` (1.0 / 1.05 / 1.05 / 1.15 / 1.25 / 1.35), palette, music key, and stop set. Districts are **freely re-visitable** from a garage globe — no district is ever taken away.

**Time of day (⭐13).** Dawn / Day / Dusk / Night. Night gives `+10%` fares and makes the Lights track matter; headlight cones, glowing windows, neon stops. Rotates per day; also manually selectable from the garage after ⭐20 (kids want to choose).

**Weather (⭐20).** Clear / Rain (puddle splashes, wipers, +8% fare) / Snow (drift is *increased* — this is fun, not punishing, and grip upgrades feel great) / Rainbow (after rain, ×1.5 for one day). Weather never reduces income and never reduces control below the tuk-tuk baseline.

**Special passenger types (⭐10+).** See §7.4 for the data shape. `dog` (barks, rides on the roof, ×1.5) · `robot` (heavy, −10% accel, ×2.0, beeps) · `birthdayKid` (confetti at drop-off, ×2.0, everyone in the car wears a party hat) · `grandma` (bonus ×1.4 if you never exceed 60% speed — a *bonus*, never a penalty) · `vip` (limo, ×1.8) · `band` (group of 4, plays a different music layer while aboard) · `chicken` (escapes at pickup and runs in circles for 3 s — pure comedy) · `astronaut` (Moon, ×2.2) · `wizard` (gives your vehicle a sparkle trail for the rest of the day) · `iceCreamFan` (only spawns for the ice-cream van, ×1.6).

**Sticker book (~60 stickers).** One-time firsts: first ride, first full car, first night ride, first dog, 100 honks, 1,000 passengers, one of each vehicle, one of each district, one of each passenger type, drove 1,000 blocks, delivered in every weather, filled the Depot. Displayed on the Depot wall. **30 stickers = the Balloon.** This is the "keeps coming back for weeks" system, because stickers are the only thing money can't buy.

**Customisation.** Per vehicle: 24 paints, 30 hats (crown, propeller cap, cowboy, cat ears, birthday cone…), 40 stick-on decals (placeable, 3 slots), 8 wheel sets, 10 trail effects (bubbles, hearts, stars, flames, rainbow). Plus 6 horn sounds and 4 engine voice pitches. Combinatorially enormous, individually cheap, and a 6-year-old will spend whole sessions here — which is fine, because it's a coin sink.

**Rotating weekly event (localStorage date-keyed, no server).** A 7-day rotation of themes derived from `Math.floor(Date.now()/86400000) % 7`: Rainbow Day (all trails free), Big Group Day (group sizes +50%), Animal Day (every passenger is an animal), Night Festival, Double Sticker Day, Race Day (boost pads everywhere), Free Paint Day. No timers, no FOMO punishment — if you miss it, it comes back next week.

---

## 7. Data-driven content model

All balance lives in `src/content/*.ts` (typed) or `*.json` (validated at boot). **No number in this document may appear in engine code.**

### 7.1 Core types

```ts
type Brand<T, B> = T & { readonly __brand: B };
export type VehicleId   = Brand<string, 'VehicleId'>;
export type UpgradeId   = Brand<string, 'UpgradeId'>;
export type DistrictId  = Brand<string, 'DistrictId'>;
export type PassengerId = Brand<string, 'PassengerId'>;
export type StickerId   = Brand<string, 'StickerId'>;
export type CosmeticId  = Brand<string, 'CosmeticId'>;

/** Every gate in the game uses this one shape. */
export interface Requirement {
  coins?: number;
  stars?: number;
  stickers?: number;
  vehiclesOwned?: number;
  requiresVehicle?: VehicleId[];
  requiresDistrict?: DistrictId[];
}
```

### 7.2 Vehicles

```ts
export type Locomotion = 'road' | 'offroad' | 'rail' | 'water' | 'air' | 'space' | 'float';

export interface VehicleDef {
  id: VehicleId;
  tier: number;                     // 1..12, drives ordering and validation
  labelKey: string;                 // i18n key — UI shows icon+art, text is secondary
  emoji: string;                    // fallback/roster icon

  // --- simulation ---
  seats: number;
  speed: number;                    // wu/s, top speed
  accel: number;                    // wu/s^2
  turnRate: number;                 // deg/s  (ignored when locomotion === 'rail')
  grip: number;                     // 0..1, lateral friction
  locomotion: Locomotion[];         // e.g. ['road','offroad'] for monster truck
  collisionMask: number;            // bitmask of what it can pass through

  // --- economy ---
  fareMult: number;
  routeEfficiencyHint: number;      // used ONLY by the balance validator
  pathLengthMult: number;           // 1.0 road, 1.4 rail
  dwellPickup: number;              // seconds
  dwellDropoff: number;
  seatUpgradeCap: number;           // ceil(seats/3), hard max 4
  passiveIncome?: { coinsPerSec: number; requiresMoving: boolean }; // ice-cream van

  // --- content shaping ---
  passengerMix: Array<{ type: PassengerId; weight: number }>;
  groupSize: { min: number; mean: number; max: number };  // triangular sample
  distanceBand: 'A' | 'B' | 'C' | 'D' | 'E';
  summonRadiusBonus?: number;       // ice-cream van

  // --- unlock ---
  unlock: Requirement;

  // --- procedural art recipe (no sprites) ---
  art: {
    silhouette: 'bubble'|'boxy'|'trike'|'long-articulated'|'monster'|'bus'
              | 'tram'|'boat'|'plane'|'rocket'|'balloon';
    lengthU: number; widthU: number; heightU: number;
    palette: { body: string; trim: string; glass: string; accent: string };
    wheels: { count: number; radius: number; offsets: [number, number][] };
    features: Array<'eyes'|'siding-door'|'stop-arm'|'cone-on-roof'|'smokestack'
                   |'propeller'|'fins'|'pantograph'|'basket'>;
    cosmeticSlots: { hat: [number,number]; decals: [number,number][] };
    tiltMax: number;                // body roll on turns, degrees
  };

  audio: {
    engine: 'putt'|'hum'|'rumble'|'diesel'|'electric'|'boat'|'prop'|'rocket'|'burner';
    basePitch: number;
    hornDefault: HornId;
  };

  perks?: Array<'shortcuts'|'auto-steer'|'no-collision'|'takeoff'|'low-gravity'|'jingle'>;
}
```

### 7.3 Upgrades

```ts
export interface UpgradeTrackDef {
  id: UpgradeId;
  emoji: string;
  scope: 'account';                 // deliberately the only value — see §2.1
  maxLevel: number;
  cost: { kind: 'geometric'; base: number; growth: number; roundTo: number }
      | { kind: 'table'; costs: number[] };
  effect:
    | { stat: 'speed';    perLevel: number }   // multiplicative-of-base fraction
    | { stat: 'fare';     perLevel: number }
    | { stat: 'turnRate'; perLevel: number; assistPerLevel: number }
    | { stat: 'seats';    perLevel: 1; requiresVehiclesOwned: (level:number)=>number }
    | { stat: 'horn';     perLevel: 0; summonRadiusPerLevel: number; unlocksSound: HornId[] }
    | { stat: 'lights';   nightRadiusPerLevel: number; nightTipPerLevel: number };
  unlock: Requirement;
}
```

### 7.4 Passengers

```ts
export interface PassengerTypeDef {
  id: PassengerId;
  emoji: string;
  fareMult: number;
  weightClass: number;              // affects accel: accelMult = 1 - 0.02*sum(weight)
  boardTimeMult: number;
  behaviour: Array<'runs-to-vehicle'|'rides-roof'|'escapes-briefly'
                  |'plays-music'|'confetti-on-drop'|'slow-ride-bonus'|'sparkle-gift'>;
  slowRideBonus?: { maxSpeedFrac: number; fareMult: number }; // grandma; bonus only
  art: { bodyShape: string; palette: string[]; accessory?: string };
  voice: { kind: 'blip'|'bark'|'beep'|'giggle'|'cheer'; pitch: number };
  unlock: Requirement;
  spawnWeightByDistrict: Partial<Record<DistrictId, number>>;
}
```

### 7.5 Districts, missions, stickers, cosmetics

```ts
export interface DistrictDef {
  id: DistrictId;
  labelKey: string;
  fareMult: number;
  surfaces: Locomotion[];
  stops: Array<{ id: string; pos: [number, number]; landmarkColor: string; landmarkShape: string }>;
  distanceMatrix?: number[][];      // generated at build/boot from the road graph
  bandsAvailable: Array<'A'|'B'|'C'|'D'|'E'>;
  palette: { sky: string; ground: string; road: string; buildings: string[] };
  musicKey: string;                 // WebAudio scale/root for procedural score
  weatherAllowed: WeatherId[];
  passengerMixOverride?: Array<{ type: PassengerId; weight: number }>;
  unlock: Requirement;
}

export interface MissionDef {
  id: string;
  icons: string[];                  // rendered as a picture sentence; no prose
  goal: { metric: MetricId; amount: number | ((tier:number)=>number) };
  rewardStars: 1;
  eligibleFromTier: number;
  repeatable: boolean;
}

export interface StickerDef {
  id: StickerId;
  emoji: string;
  trigger: { metric: MetricId; amount: number } | { event: EventId };
  bookPage: number; bookSlot: number;
}

export interface CosmeticDef {
  id: CosmeticId;
  kind: 'paint'|'hat'|'decal'|'wheels'|'trail'|'horn'|'enginePitch';
  cost: number;
  scope: 'per-vehicle'|'account';   // paint/hat/decal/wheels: per-vehicle; horn/trail: account
  render: Record<string, unknown>;  // procedural draw params
  unlock: Requirement;
}
```

### 7.6 Economy config + validator

```ts
export interface EconomyConfig {
  baseFare: number; distRate: number; blockUnits: number;
  carpoolExp: number; tipStep: number; maxHappyStars: number;
  rushMult: number; rushEveryNDeliveries: number; rushSeconds: number;
  dayLengthDeliveries: number;
  levelBonusPerStar: number;
  displayGoldBarValue: number; walletCap: number;
  piggyBankRate: number;
  validator: { tierIncomeRatioMin: 1.25; tierIncomeRatioMax: 1.55;
               maxMinutesPerTier: 14; minMinutesPerTier: 4;
               maxDisplayedWallet: 99_999; upgradeBudgetTolerance: 0.15 };
}
```

**`npm run balance` must run in CI and fail the build if:**
- any `R(t+1)/R(t)` falls outside `[1.25, 1.55]`
- any tier's projected minutes fall outside `[4, 14]`
- the sum of all upgrade-track costs deviates >15% from the projected upgrade budget
- any vehicle is strictly dominated by a cheaper one (every stat ≤, cost ≥)
- any content id is referenced but undefined, or any `Requirement` is unreachable

Output is a CSV a designer can open in a spreadsheet. **This validator is the deliverable that keeps the whole spec alive as content is added.**

### 7.7 Save schema

```ts
export interface SaveV3 {
  version: 3;
  coins: number; stars: number; trophies: number;
  ownedVehicles: VehicleId[]; activeVehicle: VehicleId;
  upgradeLevels: Record<UpgradeId, number>;
  cosmetics: { owned: CosmeticId[]; equipped: Record<VehicleId, Partial<Record<CosmeticDef['kind'], CosmeticId>>> };
  stickers: StickerId[];
  unlockedDistricts: DistrictId[]; activeDistrict: DistrictId;
  day: number; deliveriesToday: number;
  missions: Array<{ id: string; progress: number; rerolled: boolean }>;
  lifetime: Record<MetricId, number>;   // drives stickers & missions
  depot: Array<{ itemId: string; pos: [number, number] }>;
  settings: { easySteering: boolean; brakeAssist: boolean; music: number; sfx: number; endAfterDay: boolean };
  checksum: string;
}
```
Migrations are pure functions `migrate[n]: SaveN -> SaveN+1`. **A failed migration never wipes: it snapshots the old blob to `save.backup` and rebuilds a best-effort save that preserves coins, vehicles and stickers.** A 6-year-old losing their bus collection is the worst possible bug in this product.

---

## 8. Balance safety

| # | Risk | Why a 6-year-old finds it | Mitigation (all data-side unless noted) |
|---|---|---|---|
| 1 | **Odometer farming** — drive in circles to inflate distance-based fare | They *will* drive in circles for fun and notice money going up | Fare uses `distanceMatrix[origin][dest]`, fixed at spawn. **Engine rule, non-negotiable.** |
| 2 | **Zero-distance rides** — a stop adjacent to itself pays `BASE_FARE` for free | Random walk finds it | Hard floor: destination ≥ 1.2 blocks and ≠ origin; band minimum enforced at generation |
| 3 | **Reroll spam** — cancel a low-paying ride to get a better one | Tapping everything | There is **no cancel button** and rides never expire. Nothing to reroll. |
| 4 | **AFK idling** — leave the tablet on and come back rich | Parent takes the tablet away mid-ride | Only the ice-cream van has passive income, it's capped at 0.6 c/s, and it **requires movement** (`speed > 20% max`) |
| 5 | **Seat-upgrade ladder collapse** — +4 seats on the taxi, never buy anything | Buying the cheapest thing repeatedly | `seatUpgradeCap = ceil(seats/3)` and seat level L requires L+1 vehicles owned (§2.4) |
| 6 | **Group bonus runaway** — 30 passengers × linear bonus breaks the curve | Emergent, not intentional | `n^0.85` sublinear carpool curve; validated per-tier ratio ≤ 1.55 |
| 7 | **Turbo makes the game unplayable** — max speed, can't steer, quits | Buying the shiny lightning bolt | Turbo caps at +40%; Grip raises steer-assist; beyond level 6 the gain is visual-only |
| 8 | **Number inflation** — 6-digit wallet, unreadable | Natural endgame | Curve capped at ×1.38/tier, Depot + Piggy Bank sinks, gold-bar display, 99,999 cap |
| 9 | **Softlock (broke)** | Would be catastrophic | Structurally impossible: zero operating costs, income always > 0, cheapest purchase is 20 coins ≈ 15 s of play. Assert in code: `cheapestPurchasableItem.cost <= 30`. |
| 10 | **Tip mechanic punishes slow/careful kids** | Speed-based tips would | Tips come only from *positive optional actions* (honk, pickup, boost pad). `tip ≥ 0` always. Grandma's slow-ride is a **bonus**, never a penalty. |
| 11 | **Double-tap buys two things** | Fat fingers, laggy tablet | 400 ms input debounce on all shop buttons + **7-second undo** on every purchase |
| 12 | **A parent "helps" and rockets them to tier 11 in one session** | Adults optimise | Star gates (§5.4) cap progression at ~1 vehicle per 2 in-game days regardless of coin income |
| 13 | **Dominated purchase** — a vehicle that's worse than the one before | Content authored later | Validator rule: no vehicle may be dominated on `(seats, speed, fareMult, cost)`; §3.4 ratios must be monotonically increasing |
| 14 | **Weather/night reduces income and feels like punishment** | They'll blame the rain | Contract: every weather and time-of-day modifier is `≥ 1.0`. Snow *increases* drift (fun) but also `fareMult 1.1`. |
| 15 | **Save corruption on a shared tablet** | Sibling, storage limits | Versioned schema + checksum + `save.backup` + best-effort rebuild (§7.7). Never a hard wipe. |
| 16 | **Rainbow Rush stacking with Golden Routes → absurd payout** | Endgame emergent | `payout` multipliers are additive-then-capped: `min(rush + golden - 1, 5.0)` |

**One-line engineering contract to put at the top of `economy.ts`:**

```
// Coins only ever go up from play. There is no timer, no penalty, no expiry,
// no failure, and no purchase that can be regretted. If a change violates this,
// it is not a balance change — it is a design change, and it needs a new spec.
```