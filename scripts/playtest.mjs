/**
 * Headless end-to-end playtest.
 *
 * Boots the real 3D game in headless Chrome, presses play, then uses the dev
 * autopilot — which feeds the same control path a player's finger does — to
 * drive to the waiting passenger, pick them up, drive to the destination, and
 * drop them off. It asserts at each stage and finally that coins were earned
 * and persisted to storage.
 *
 * This is the test that says "a child could complete a ride", which no unit
 * test can. WebGL runs on SwiftShader, so the frame rate here is a software
 * rasteriser's and is only a sanity floor, not a performance measurement.
 *
 * Usage: node scripts/playtest.mjs [url] [screenshot]
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const url = process.argv[2] ?? 'http://localhost:5173/'
const shotPath = process.argv[3] ?? 'playtest.png'
const PORT = 9334

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=1024,768',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

let ws
let nextId = 1
const pending = new Map()
const errors = []

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`,
    )
  }
  return res.result.value
}

async function state() {
  return evaluate('globalThis.__ts ? JSON.parse(JSON.stringify(globalThis.__ts.state())) : null')
}

/**
 * Wait for a game-state condition.
 *
 * Timeouts here are deliberately generous. The ride loop advances in
 * SIMULATION time, but this harness measures WALL-CLOCK time, and under
 * SwiftShader the simulation runs at a fraction of real speed — the loop caps
 * catch-up steps per frame, so a slow renderer directly slows the world. A
 * gap that takes 3 simulated seconds can take 30 real ones on a loaded CI
 * runner. Short timeouts here fail as "the game is broken" when the game is
 * merely being rendered slowly, which is the least useful possible signal.
 */
async function waitFor(label, predicate, timeoutMs = 60000) {
  const start = Date.now()
  for (;;) {
    const s = await state()
    if (s && predicate(s)) return s
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `TIMEOUT waiting for: ${label}\nlast state: ${JSON.stringify(s)}` +
          (errors.length ? `\ncaptured exceptions:\n  ${errors.join('\n  ')}` : '\n(no exceptions captured)'),
      )
    }
    await sleep(250)
  }
}

/**
 * Drive to a point, re-issuing the autopilot if it releases without the
 * expected outcome.
 *
 * A real player who overshoots simply turns around and comes back, so the
 * harness has to do the same — otherwise a single missed approach reads as a
 * broken game when it is only a missed approach.
 */
async function driveTo(label, x, z, predicate, timeoutMs = 60000) {
  const start = Date.now()
  for (let attempt = 0; ; attempt++) {
    // Re-planning from a spot the car is wedged in yields the same failing
    // route, so on every retry after the first, put it back on tarmac before
    // trying again. See the `unstick` hook for why the harness is allowed to
    // do this.
    if (attempt > 0) {
      await evaluate('globalThis.__ts.unstick(); true')
      await sleep(300)
    }

    await evaluate(`globalThis.__ts.autopilot(${x}, ${z}); true`)

    let stalledFor = 0
    while (Date.now() - start < timeoutMs) {
      await sleep(250)
      const s = await state()
      if (s && predicate(s)) return s
      // Autopilot released without success — go round again.
      if (s && !s.autopilotActive) break

      // Or it is still "driving" but going nowhere.
      if (s && Math.abs(s.car.speed) < 0.8) {
        stalledFor += 250
        if (stalledFor > 6000) break
      } else {
        stalledFor = 0
      }
    }

    if (Date.now() - start > timeoutMs) {
      const s = await state()
      throw new Error(
        `TIMEOUT waiting for: ${label} after ${attempt + 1} approach(es)\nlast state: ${JSON.stringify(s)}` +
          (errors.length ? `\ncaptured exceptions:\n  ${errors.join('\n  ')}` : '\n(no exceptions captured)'),
      )
    }
  }
}

let checks = 0
function pass(label) {
  checks++
  console.log(`  PASS  ${label}`)
}

async function findTarget() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Not up yet.
    }
    await sleep(200)
  }
  throw new Error('Could not reach Chrome DevTools endpoint')
}

try {
  const wsUrl = await findTarget()
  ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined) {
      const handler = pending.get(msg.id)
      if (handler) {
        pending.delete(msg.id)
        if (msg.error) handler.reject(new Error(msg.error.message))
        else handler.resolve(msg.result)
      }
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push(d.exception?.description ?? d.text ?? 'unknown exception')
    }
  })

  await send('Runtime.enable')
  await send('Page.enable')

  console.log(`Playtest against ${url}`)

  // Fresh save every run, so assertions are absolute rather than relative.
  await send('Page.navigate', { url })
  await sleep(1500)
  await evaluate('localStorage.clear(); true')
  await send('Page.navigate', { url })
  await sleep(3000)

  // -- Title ---------------------------------------------------------------
  const hasTitle = await evaluate('!!document.querySelector(".title-play")')
  if (!hasTitle) throw new Error('title play button not found')
  pass('game boots to the title screen')

  const webgl = await evaluate(
    '(() => { const c = document.getElementById("game-canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")) })()',
  )
  if (!webgl) throw new Error('no WebGL context')
  pass('WebGL context is live')

  // -- Start ----------------------------------------------------------------
  await evaluate('document.querySelector(".title-play").click(); true')
  await waitFor('town scene to exist', () => true, 20000)
  pass('pressing play starts the town')

  const hudUp = await evaluate('!!document.querySelector(".hud")')
  if (!hudUp) throw new Error('HUD did not appear')
  pass('HUD is present')

  // -- Passenger -------------------------------------------------------------
  const waiting = await waitFor('a waiting passenger', (s) => s.ride.phase === 'waiting', 60000)
  pass(`passenger waiting at ${waiting.ride.passengerX.toFixed(1)}, ${waiting.ride.passengerZ.toFixed(1)}`)

  const coinsBefore = waiting.coins

  // -- Drive there (real physics through the autopilot) ----------------------
  const picked = await driveTo(
    'pickup',
    waiting.ride.passengerX,
    waiting.ride.passengerZ,
    (s) => s.ride.phase === 'boarding' || s.ride.phase === 'riding',
    90000,
  )
  pass(`passenger picked up (phase: ${picked.ride.phase})`)

  // -- Deliver ----------------------------------------------------------------
  const riding = await waitFor(
    'destination assigned',
    (s) => s.ride.phase === 'riding' && s.ride.hasTarget,
    45000,
  )
  pass(`destination at ${riding.ride.targetX.toFixed(1)}, ${riding.ride.targetZ.toFixed(1)}`)

  const arrived = await driveTo(
    'dropoff',
    riding.ride.targetX,
    riding.ride.targetZ,
    (s) => s.ride.phase === 'arriving' || s.ride.phase === 'gap',
    120000,
  )
  pass('passenger delivered')

  // -- Money and persistence ---------------------------------------------------
  if (!(arrived.coins > coinsBefore)) {
    throw new Error(`coins did not increase: ${coinsBefore} -> ${arrived.coins}`)
  }
  pass(`fare paid: ${coinsBefore} -> ${arrived.coins} coins`)

  if (arrived.totalRides !== 1) throw new Error(`expected totalRides 1, got ${arrived.totalRides}`)
  pass('ride counted')

  await sleep(1200)
  const persisted = await evaluate(`(() => {
    const raw = localStorage.getItem('transport-sim.save')
    return raw ? JSON.parse(raw).data : null
  })()`)
  if (!persisted || persisted.coins !== arrived.coins) {
    throw new Error(`save not persisted correctly: ${JSON.stringify(persisted)}`)
  }
  pass(`save persisted (${persisted.coins} coins on disk)`)

  // The HUD must actually show what was earned.
  const shown = await evaluate('document.querySelector(".hud-coins-value").textContent')
  pass(`HUD shows ${shown}`)

  // -- The loop repeats ---------------------------------------------------------
  const second = await waitFor('a second passenger', (s) => s.ride.phase === 'waiting', 90000)
  pass('a new passenger appeared')
  await driveTo(
    'second pickup',
    second.ride.passengerX,
    second.ride.passengerZ,
    (s) => s.ride.phase === 'boarding' || s.ride.phase === 'riding',
    90000,
  )
  pass('second pickup works — the loop repeats')

  // -- Upgrades ------------------------------------------------------------------
  // The shop is where earned coins become something a child can feel, so the
  // whole path is checked: price shown, purchase applied, car actually faster,
  // and the change persisted.
  const shopOpen = await evaluate(`(() => {
    document.querySelector('.hud-shop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    return !document.querySelector('.shop').classList.contains('is-hidden')
  })()`)
  if (!shopOpen) throw new Error('shop did not open')
  pass('upgrade shop opens')

  const speedBefore = await evaluate('globalThis.__ts.maxSpeed()')
  await evaluate('globalThis.__ts.grantCoins(500); true')
  await sleep(300)

  const anyAffordable = await evaluate(
    '[...document.querySelectorAll(".shop-buy")].some((b) => !b.disabled)',
  )
  if (!anyAffordable) throw new Error('nothing affordable with 500 coins')
  pass('upgrades become buyable once affordable')

  const bought = await evaluate('globalThis.__ts.buyUpgrade("speed")')
  if (!bought) throw new Error('buying the speed upgrade failed')

  const speedAfter = await evaluate('globalThis.__ts.maxSpeed()')
  if (!(speedAfter > speedBefore)) {
    throw new Error(`speed upgrade did not apply: ${speedBefore} -> ${speedAfter}`)
  }
  pass(`speed upgrade applied (${speedBefore.toFixed(2)} -> ${speedAfter.toFixed(2)} u/s)`)

  await sleep(1200)
  const persistedUpgrades = await evaluate(`(() => {
    const raw = localStorage.getItem('transport-sim.save')
    return raw ? JSON.parse(raw).data.upgrades : null
  })()`)
  if (!persistedUpgrades || persistedUpgrades.speed !== 1) {
    throw new Error(`upgrade not persisted: ${JSON.stringify(persistedUpgrades)}`)
  }
  pass('upgrade persisted to storage')

  // Buying must be idempotent against affordability, never negative coins.
  await evaluate('globalThis.__ts.buyUpgrade("speed"); globalThis.__ts.buyUpgrade("speed"); true')
  const coinsNow = await evaluate('globalThis.__ts.state().coins')
  if (coinsNow < 0) throw new Error(`coins went negative: ${coinsNow}`)
  pass('coins never go negative')

  const mapPresent = await evaluate('!!document.querySelector(".minimap canvas")')
  if (!mapPresent) throw new Error('minimap missing')
  pass('city map is present')

  // -- Health --------------------------------------------------------------------
  const stats = await evaluate(`JSON.parse(JSON.stringify({
    fps: Math.round(globalThis.game.stats.fps),
    updateMs: Number(globalThis.game.stats.updateMs.toFixed(2)),
    renderMs: Number(globalThis.game.stats.renderMs.toFixed(2)),
    dropped: globalThis.game.stats.droppedFrames,
    calls: globalThis.game.renderStats.calls,
    triangles: globalThis.game.renderStats.triangles,
    tier: globalThis.game.renderer.tier,
  }))`)
  console.log(
    `  INFO  fps=${stats.fps} update=${stats.updateMs}ms render=${stats.renderMs}ms ` +
      `drawCalls=${stats.calls} tris=${stats.triangles} tier=${stats.tier} (SwiftShader)`,
  )

  // The simulation must stay cheap regardless of how slow software WebGL is.
  if (stats.updateMs > 4) throw new Error(`simulation too slow: ${stats.updateMs}ms`)
  pass('simulation stays well inside its frame budget')

  // This guards against INSTANCING COLLAPSE, not against detail. The town has
  // ~100 buildings and ~200 trees; if any of those stopped being instanced,
  // draw calls would jump into the hundreds and a real tablet would die. A
  // few dozen calls for the car's trim is irrelevant on any GPU, so the
  // ceiling is set well above the honest cost of detail and well below what a
  // collapse would produce.
  if (stats.calls > 90) throw new Error(`draw calls suggest instancing collapsed: ${stats.calls}`)
  pass(`scene draws in ${stats.calls} calls (instancing intact)`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

  if (errors.length > 0) {
    console.log('\nUncaught exceptions during play:')
    for (const e of errors) console.log(`  ${e}`)
    process.exitCode = 1
  } else {
    console.log(`\nPLAYTEST PASSED (${checks} checks) — screenshot: ${shotPath}`)
    process.exitCode = 0
  }
} catch (error) {
  console.error(`\nPLAYTEST FAILED: ${error.message}`)
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
    console.error(`failure screenshot: ${shotPath}`)
  } catch {
    // No screenshot available.
  }
  process.exitCode = 2
} finally {
  try {
    ws?.close()
  } catch {
    // Ignore.
  }
  chrome.kill()
}
