light-up wave is an alpha cross-fade between two already-baked building canvases plus ~8 sparkle blits per building, staggered so peak concurrency is ~40 buildings (320 blits). Fireworks peak at 420 particles, within the Tier A budget. The sunset is the existing grade function driven on a scripted timeline. The camera move is the existing spring. The vehicle arrival reuses the normal vehicle pipeline. **Not one new drawing primitive is required.** The entire set piece is a 200-line timeline script over systems that already exist for gameplay.

**Tier degradation for the wow moment:** Tier B uses 4 shells × 50 particles, a 600 px/s wave, and skips per-window sparkles (buildings still cross-fade). Tier C uses 3 shells × 40, cross-fades buildings in distance bands of 12 rather than individually, and skips the star layer. The moment still lands at every tier because its power comes from *scale and timing*, not particle count.

**Safety constraints on the set piece:** the fireworks flash rings are capped at 3 per second globally (photosensitivity), the white flash ring alpha is capped at 0.45 (never a full-screen white flash), and in Gentle Mode the flash rings are replaced with soft expanding color rings at alpha 0.25 and the shell count drops to 4. The audio peak is limited to -6 dBFS at the burst.

**Reuse:** the same timeline system runs three shorter variants — a 2.5 s **first delivery** celebration (light-up wave only, radius 600 px, no fireworks), a 4 s **streak-10** celebration (fireworks only, no sunset), and a 1.2 s **paint job applied** flourish (spotlight + shine sweep + confetti puff). One timeline format, four payoffs.

---

## 9. Implementation Contract for the Engineer

The art system needs exactly these modules. Nothing here depends on gameplay code.

```
palette.ts        All hex tokens, the 8 building families, 12 paints,
                  hslShift(), deriveShade(), deriveLight(), routeEncoding[].
grade.ts          gradeAt(t, weather) → {multiply, screen, lightsOn, starAlpha}.
                  applyGrade(ctx, grade) → 2 full-screen fills.
ease.ts           The §5.0 library + smooth() + Spring class.
                  Pure functions, zero allocation.
tween.ts          Tween pool: {target, prop, from, to, durMs, ease, onDone}.
                  Advanced by the RENDER clock. Max 256 live tweens, pooled.
timeline.ts       Keyframed event script (used by §8 and all celebrations).
                  Entries: {atMs, fn}. Skippable, seekable.
paths.ts          Path2D factories: roundRectPath(), blobPath(lobes, radii),
                  vehicleSilhouette(profile, L, W), starPath(n, rOuter, rInner),
                  heartPath(), arrowPath(), the 24 building pictograms,
                  the 12 hair styles, the 12 species head modules.
                  All pure, all cached by parameter hash.
painter.ts        The render abstraction. Methods: fillPath, strokePath, blit,
                  blitRotated, setLayer, pushClip, popClip, setComposite.
                  Canvas2D backend now; the method set is deliberately
                  WebGL-expressible (no clip-heavy tricks in the hot path).
bake.ts           OffscreenCanvas pool + LRU with a byte budget.
                  bakeBuilding(spec) → {canvas, dayRect, nightRect, anchor}
                  bakeCharacter(spec) → {canvas, poses[4], anchor}
                  bakeTree, bakeCloud, bakeGlyphAtlas, bakeParticleAtlas,
                  bakeLightSprites, bakeAsphaltPattern.
draw/*.ts         drawVehicle, drawCharacter, drawBuilding, drawTree,
                  drawRoadNetwork, drawWater, drawCoin, drawBubble, drawBeacon.
                  Each takes (painter, spec, state, lod). No side effects.
particles.ts      Struct-of-arrays pools: x,y,vx,vy,life,maxLife,size,rot,
                  vrot,colorIdx,spriteIdx,kind. Fixed capacity per tier.
                  One update loop, one batched draw per sprite/composite pair.
juice.ts          Named effect emitters: coinBurst(), confetti(), starburst(),
                  numberPopup(), screenFlash(), dustPuff(), splash(),
                  skidSegment(), speedLines(). Each is one call from gameplay.
camera.ts         Position spring, lookahead, zoom smoothing, deadzone,
                  trauma shake, bounds clamp, punchIn(), setGentleMode().
audio/*.ts        graph.ts (buses, limiter, ducking), engine.ts, sfx.ts
                  (the recipe table), voice.ts (blip generator),
                  music.ts (scheduler, layers, adaptive rules),
                  ambience.ts, reverb.ts (procedural IR).
quality.ts        Tier definitions, frame-time ring buffer, degrade/upgrade
                  state machine, render-scale management.
```

**Two APIs everything else should be built through:**

```ts
// Every visual reaction in the game is one line of gameplay code.
juice.emit('coinBurst', { x, y, amount: fare, toHud: true });
juice.emit('delivery',  { x, y, streak });

// Every sound is one line.
audio.play('coinChime', { ladderStep: i });
audio.play('voice', { characterId, emotion: 'happy' });
```

If a gameplay engineer ever has to write easing math or an oscillator graph inline, the art system has failed.

---

## 10. Build Order (art system only)

| Phase | Deliverable | Why first |
|---|---|---|
| 1 | `palette`, `ease`, `paths`, `painter`, one vehicle drawn with the double-stamp + shadow + outline + face | This single screenshot proves or kills the entire art direction. Get it on a tablet in week one. |
| 2 | Camera (follow, lookahead, zoom, deadzone), body roll, squash/stretch, wheel tread, idle bob | Driving must feel good before anything else exists. If the car alone isn't fun to steer around an empty green field, no amount of city will fix it. |
| 3 | Road stroke pipeline + asphalt pattern + markings + world tile baking | The world's foundation, and it's mostly free once the stroke trick is in. |
| 4 | Buildings (bake, families, variation), trees, ground | The city appears. |
| 5 | Characters (generator, bake, face, expressions) + passenger juice | Now it has a soul. |
| 6 | Audio graph + engine + coin ladder + UI clicks | The coin ladder alone will roughly double perceived polish. |
| 7 | `particles`, `juice` emitters, coin burst, number popups, confetti | The reward loop closes. |
| 8 | Grade function, day/night, window lights, headlight cones, streetlamps | The world gains time. |
| 9 | Music layers + ambience + ducking | The world gains mood. |
| 10 | Weather, birds, cloud shadows, pedestrians, ambient traffic | The world gains life. |
| 11 | `timeline` + the CITY LIGHT-UP set piece | The payoff. |
| 12 | `quality` tiers + auto-degrade + Gentle Mode | Ship gate. Do not ship without measuring on the actual worst target device. |

---

## 11. Acceptance Criteria (how to know the art direction succeeded)

1. **The 24-pixel test.** Screenshot any object at 24 px tall, convert to pure black silhouette. A stranger can name it.
2. **The still-frame test.** Pause the game at any random moment. The frame looks like a deliberate illustration — no object without a shadow, no object without an outline, no more than three values per object, no pure black or white fill.
3. **The 30-second stillness test.** Set the game down with no input. Within 30 seconds you should observe: trees swaying, a cloud shadow crossing, a bird flock, a pedestrian waving, a passenger jumping, the car breathing, the camera drifting to a hint. Nothing is frozen.
4. **The reaction latency test.** Every touch produces visible motion within 50 ms and audible feedback within 30 ms. Measure with a high-speed camera on the actual tablet, not in the browser profiler.
5. **The repetition test.** Pan across the full city. No two adjacent buildings share a silhouette *and* a color. No two visible passengers are identical.
6. **The greyscale test.** Screenshot in greyscale. Every gameplay-critical distinction (route matching, pickup vs. dropoff, locked vs. affordable) is still readable.
7. **The 60fps test.** Sustained 60 fps on the oldest supported iPad and a 4 GB Chromebook, with 14 AI vehicles, 24 pedestrians, rain on, night, and a coin burst firing — measured over 5 minutes, not 5 seconds.
8. **The 6-year-old test.** Hand it to one. If they press the horn more than five times in the first minute, drive in circles to watch the skid marks, or chase a cloud shadow — the juice is working. If they ask "what does it say?", something in the UI is depending on text and must be redesigned.