# Transport Simulator

A friendly transportation company simulator built for young children (target age ~6).

You start with a small taxi, drive around town picking up passengers, earn coins, and grow
your fleet toward vans, limos, buses and beyond. There is no way to lose, no timers, and no
reading required.

## Design constraints

These shaped almost every technical decision in the project:

- **Static hosting.** Ships to GitHub Pages. No backend, no database, no accounts.
  Progress is saved to `localStorage`.
- **No asset files.** There are no models, textures or audio clips. Every solid is generated
  from procedural geometry at startup and every sound is synthesised with the WebAudio API.
  Nothing is fetched, and sound reacts continuously to gameplay rather than being fixed clips.
- **One runtime dependency.** Three.js, for WebGL rendering. Everything else is first-party.
- **Touch and keyboard equal citizens.** A tablet is the expected device; a desktop must work
  just as well.
- **Deterministic world.** All generation runs off a seeded RNG, so a child's town never
  rearranges itself between sessions.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run verify` | Boot the game in headless Chrome, assert on live engine state, screenshot |

| `npm run playtest` | Play a full ride in a real browser and assert coins are earned |

`npm run playtest` is the one worth knowing about. It boots the real game in headless Chrome,
presses play, then drives the actual physics to a passenger, picks them up, delivers them, and
asserts the fare was paid, counted, persisted to storage and shown in the HUD.

It exists because a green build and green unit tests are not evidence that a child can complete
a ride. It has already caught, among others: a same-frame tap being dropped on the "tap
anywhere to start" screen, a stale guidance target pointing the wrong way for one frame, an
invisible speed gate that silently refused pickups, and street trees that wedged the car
against the kerb at the exact spot the game told the player to park.

```bash
npm run dev &
npm run playtest -- http://localhost:5173/ shot.png
```

WebGL runs on SwiftShader in headless Chrome, so the frame rate it reports is a software
rasteriser's and is only a sanity floor — the meaningful assertions are the draw-call ceiling
and the simulation cost, both of which are hardware-independent.

## Architecture

```
src/
  engine/          Reusable, game-agnostic. Knows nothing about taxis.
    core/          Fixed-timestep loop, scene stack, event bus,
                   versioned save/load, settings + adaptive quality tiers
    three/         WebGL renderer, chase camera, lighting/sky, procedural
                   geometry helpers, instanced particle system
    input/         Unified pointer / keyboard / gamepad with named action mapping
    anim/          Easing library, tween manager, spring values
    audio/         WebAudio graph, limiter, voice management
    spatial/       Uniform spatial hash for proximity queries
    math/          Scalars, vectors, seeded RNG
  game/            This specific game.
    art/           Procedural car and character models
    world/         Road network, seeded city generation
    entities/      Car physics with road assist
    systems/       The ride loop
    ui/            DOM HUD and title screen
    scenes/        The town
    config/        Branding, input bindings
  content/         Data-driven vehicle definitions
docs/design/       Design specifications produced during planning
```

The split between `engine/` and `game/` is deliberate: nothing in `engine/` may import from
`game/`. That boundary is what keeps the engine reusable and the game code readable as it
grows.

### Notes on a few choices

**Fixed timestep.** Steering, spring cameras and the economy all behave differently at 30fps
versus 144fps if they integrate raw frame deltas. Pinning the simulation to 60Hz makes
behaviour identical across devices and makes headless simulation possible.

**Everything is instanced.** The whole town — roads, ~100 buildings, ~200 trees, all particles
— draws in under 40 calls. Instancing is the entire performance strategy on a tablet, so the
playtest asserts a draw-call ceiling; if instancing regresses, the test fails rather than the
frame rate quietly collapsing on someone's device.

**Nothing has a sharp edge.** Every solid is a rounded primitive. A cube reads as Minecraft;
the same cube with a generous corner radius reads as a toy.

**Struct-of-arrays particles.** Fixed-capacity pools with zero allocation after construction.
A child mashing the horn must not trigger a GC pause.

**Road assist, gated by alignment.** The car's heading is eased toward the road it is on, so
drifting off by accident mostly does not happen. The assist releases when the road runs
crosswise, because at a junction the *nearest* road is the one being crossed — without that
gate the car visibly fights a child driving straight through.

**Saves are defensive.** Versioned schema with forward migrations, a backup slot, debounced
writes, and graceful degradation when storage is unavailable. Losing a child's progress is
worse than any crash.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which installs dependencies, runs
the tests, builds with the correct base path for a GitHub Pages project site, and publishes.

Pages must be configured once in **Settings → Pages → Build and deployment → Source →
GitHub Actions**.

## Licence

Unlicensed / all rights reserved unless stated otherwise.
