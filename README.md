# Transport Simulator

A friendly transportation company simulator built for young children (target age ~6).

You start with a small taxi, drive around town picking up passengers, earn coins, and grow
your fleet toward vans, limos, buses and beyond. There is no way to lose, no timers, and no
reading required.

## Design constraints

These shaped almost every technical decision in the project:

- **Static hosting.** Ships to GitHub Pages. No backend, no database, no accounts.
  Progress is saved to `localStorage`.
- **No asset files.** Every visual is drawn with Canvas2D path commands at runtime, and every
  sound is synthesised with the WebAudio API. Nothing is fetched, so the bundle stays tiny and
  sound can react continuously to gameplay rather than being fixed clips.
- **Zero runtime dependencies.** The shipped bundle is entirely first-party code.
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

`npm run verify` is worth knowing about. It drives Chrome over the DevTools Protocol with no
extra dependencies, captures console errors and uncaught exceptions, and reads real engine
state — frame rate, simulation steps, dropped frames, active scene. It exists because a green
build and green tests are not evidence that the game actually runs; it has already caught a
constructor-ordering crash that both of those missed.

```bash
npm run dev &
npm run verify -- http://localhost:5173/ shot.png 4000
```

## Architecture

```
src/
  engine/          Reusable, game-agnostic. Knows nothing about taxis.
    core/          Game shell, fixed-timestep loop, scene stack, event bus,
                   versioned save/load, settings + adaptive quality tiers
    render/        Viewport & DPR handling, camera, colour system, path primitives
    input/         Unified pointer / keyboard / gamepad with named action mapping
    anim/          Easing library, tween manager, spring values
    fx/            Pooled particle system
    audio/         WebAudio graph, limiter, voice management
    spatial/       Uniform spatial hash for proximity queries
    debug/         Frame-time graph and state overlay
  game/            This specific game.
    config/        Branding, input bindings
    scenes/        Boot scene (currently an engine smoke test)
docs/design/       Design specifications produced during planning
```

The split between `engine/` and `game/` is deliberate: nothing in `engine/` may import from
`game/`. That boundary is what keeps the engine reusable and the game code readable as it
grows.

### Notes on a few choices

**Fixed timestep with interpolated rendering.** Steering, spring cameras and the economy all
behave differently at 30fps versus 144fps if they integrate raw frame deltas. Pinning the
simulation to 60Hz makes behaviour identical across devices and makes headless balance
simulation possible.

**Struct-of-arrays particles.** Fixed-capacity pools with zero allocation after construction.
A child mashing the horn must not trigger a GC pause.

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
