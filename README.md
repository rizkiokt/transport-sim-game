# Transport Simulator

A friendly transportation company simulator built for young children (target age ~6).

You start with a small taxi, drive around an endless city picking up passengers, earn coins,
and grow your fleet toward vans, limos, buses and beyond. Once you own more than one vehicle
you can hire drivers to work the cars you are not in, so the company keeps earning while you
play. Park anywhere, step out, walk into your own depot and pick a different car.

There is no way to lose, no timers, and no reading required.

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
- **Deterministic world.** All generation runs off a seeded RNG keyed on chunk coordinates,
  so the city is endless but never rearranges itself — drive away for ten minutes, come back,
  and the same buildings are there. Nothing about the world is stored in the save.
- **No dead ends.** Every state has a way out: the car can always steer free of a wall, and
  fast travel always returns to the depot from anywhere in an infinite map.

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
    world/         Chunk-streamed endless city, arithmetic road grid, depot
    entities/      Car physics with road assist, on-foot player
    systems/       The ride loop, ambient traffic, pedestrian crowd, the company
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

**Everything is instanced, and draw calls do not grow with the world.** The city streams in
chunks, but there is *not* one mesh per chunk — that would put a hundred-odd draw calls on
screen and get worse the further you can see. Instead a fixed set of large `InstancedMesh`es
covers the whole visible area, and loading or unloading a chunk rewrites their instance
buffers. Roughly 2,400 buildings, 2,300 trees, 18 traffic cars and 30 pedestrians draw in
about 70 calls, and that number is the same whether one chunk is loaded or fifty. The playtest
asserts a draw-call ceiling; if instancing regresses, the test fails rather than the frame rate
quietly collapsing on someone's device.

**Roads are arithmetic, not geometry.** The old finite town stored an array of road segments
and scanned it to answer "where is the nearest road?". On a regular grid every road is a line
at `x = n * blockSize` or `z = n * blockSize`, so the nearest one is a rounding operation — no
arrays, no allocation, no scan, and it answers for any coordinate however far out. That single
change is both what makes an endless world possible and a straight performance win over what
it replaced. The same insight drives the minimap, the traffic AI and the pedestrian walk.

**The depot is the anchor.** An endless city has no landmarks by construction: every junction
looks like every other junction. The depot is always at the same coordinates, always on the
map, and fast travel always returns to it — which is what stops "infinite" from meaning
"lost". Your fleet is parked inside it, so owning four cars means driving to a building and
seeing four cars in it.

**Streaming radius is tied to draw distance.** A far plane beyond the loaded radius shows the
city ending at a hard line in mid-air. The two numbers are asserted to move together in a unit
test, and the radius follows the adaptive quality tier at runtime — without that, a tablet
downgraded three seconds after launch keeps building a high-tier world behind the fog for the
rest of the session.

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
