/**
 * Headless end-to-end playtest.
 *
 * Boots the real game in headless Chrome, taps through the title screen,
 * then uses the dev autopilot (which feeds the same controls path as a
 * player's finger) to drive to the waiting passenger, pick them up, drive
 * to the destination, and drop them off — asserting at each stage and
 * finally that coins were earned and persisted.
 *
 * This is the test that says "a child could complete a ride", which no unit
 * test can. Zero dependencies; Node's global WebSocket + Chrome's DevTools
 * protocol.
 *
 * Usage: node scripts/playtest.mjs [url]
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const url = process.argv[2] ?? 'http://localhost:5175/'
const shotPath = process.argv[3] ?? 'playtest.png'
const PORT = 9334

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
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
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) {
    throw new Error(`evaluate failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`)
  }
  return res.result.value
}

async function state() {
  return evaluate('globalThis.__ts ? JSON.parse(JSON.stringify(globalThis.__ts.state())) : null')
}

/** Poll until `predicate(state)` is true or the timeout elapses. */
async function waitFor(label, predicate, timeoutMs = 30000) {
  const start = Date.now()
  for (;;) {
    const s = await state()
    if (s && predicate(s)) return s
    if (Date.now() - start > timeoutMs) {
      throw new Error(`TIMEOUT waiting for: ${label}\nlast state: ${JSON.stringify(s)}`)
    }
    await sleep(250)
  }
}

const steps = []
function pass(label) {
  steps.push(`  PASS  ${label}`)
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

  // Fresh save every run so assertions are absolute, not relative.
  await send('Page.navigate', { url })
  await sleep(1500)
  await evaluate('localStorage.clear(); true')
  await send('Page.navigate', { url })
  await sleep(2500)

  // -- Title screen -------------------------------------------------------
  const title = await evaluate('globalThis.game ? globalThis.game.scenes.stackNames.join(",") : "no-game"')
  if (title !== 'title') throw new Error(`expected title scene, got: ${title}`)
  pass('game boots to the title scene')

  // Tap to start — and tap again if nothing happened, exactly as a child
  // would. The transition sits behind a short delay, so poll between taps.
  let inTown = false
  for (let attempt = 0; attempt < 6 && !inTown; attempt++) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: 512, y: 384, button: 'left', clickCount: 1 })
    }
    for (let poll = 0; poll < 6 && !inTown; poll++) {
      await sleep(300)
      const scene = await evaluate('globalThis.game.scenes.stackNames.join(",")')
      if (scene.includes('town')) inTown = true
    }
  }
  if (!inTown) throw new Error('town scene never started after repeated taps')
  pass('tapping the title starts the town')

  // -- Wait for a passenger ----------------------------------------------
  const withPassenger = await waitFor('a waiting passenger', (s) => s.ride.phase === 'waiting', 10000)
  pass(`passenger waiting at ${withPassenger.ride.passengerX.toFixed(0)},${withPassenger.ride.passengerY.toFixed(0)}`)

  const coinsBefore = withPassenger.coins

  // -- Drive to the passenger (real physics via the autopilot) ------------
  await evaluate(`globalThis.__ts.autopilot(${withPassenger.ride.passengerX}, ${withPassenger.ride.passengerY}); true`)
  const picked = await waitFor(
    'pickup (boarding or riding phase)',
    (s) => s.ride.phase === 'boarding' || s.ride.phase === 'riding',
    45000,
  )
  pass(`passenger picked up (phase: ${picked.ride.phase})`)

  // -- Drive to the destination -------------------------------------------
  const riding = await waitFor('destination assigned', (s) => s.ride.phase === 'riding' && s.ride.hasTarget, 10000)
  pass(`destination at ${riding.ride.targetX.toFixed(0)},${riding.ride.targetY.toFixed(0)}`)

  await evaluate(`globalThis.__ts.autopilot(${riding.ride.targetX}, ${riding.ride.targetY}); true`)
  const arrived = await waitFor('dropoff (arriving/gap phase)', (s) => s.ride.phase === 'arriving' || s.ride.phase === 'gap', 60000)
  pass('passenger delivered')

  // -- Money and persistence ----------------------------------------------
  if (!(arrived.coins > coinsBefore)) {
    throw new Error(`coins did not increase: ${coinsBefore} -> ${arrived.coins}`)
  }
  pass(`fare paid: ${coinsBefore} -> ${arrived.coins} coins`)

  if (arrived.totalRides !== 1) {
    throw new Error(`expected totalRides 1, got ${arrived.totalRides}`)
  }
  pass('ride counted')

  // Force the debounced write, then check what's actually in storage.
  await sleep(1200)
  const persisted = await evaluate(`(() => {
    const raw = localStorage.getItem('transport-sim.save')
    if (!raw) return null
    return JSON.parse(raw).data
  })()`)
  if (!persisted || persisted.coins !== arrived.coins) {
    throw new Error(`save not persisted correctly: ${JSON.stringify(persisted)}`)
  }
  pass(`save persisted (${persisted.coins} coins on disk)`)

  // -- A second ride proves the loop repeats -------------------------------
  const second = await waitFor('second passenger', (s) => s.ride.phase === 'waiting', 10000)
  pass('a new passenger appeared')
  await evaluate(`globalThis.__ts.autopilot(${second.ride.passengerX}, ${second.ride.passengerY}); true`)
  await waitFor('second pickup', (s) => s.ride.phase === 'boarding' || s.ride.phase === 'riding', 45000)
  pass('second pickup works — the loop repeats')

  // -- Performance under load ----------------------------------------------
  const stats = await evaluate(`JSON.parse(JSON.stringify({
    fps: Math.round(globalThis.game.stats.fps),
    updateMs: Number(globalThis.game.stats.updateMs.toFixed(2)),
    renderMs: Number(globalThis.game.stats.renderMs.toFixed(2)),
    dropped: globalThis.game.stats.droppedFrames,
  }))`)
  console.log(`  INFO  fps=${stats.fps} update=${stats.updateMs}ms render=${stats.renderMs}ms dropped=${stats.dropped}`)
  if (stats.fps < 50) throw new Error(`fps too low: ${stats.fps}`)
  pass('holds a healthy frame rate mid-ride')

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

  if (errors.length > 0) {
    console.log('\nUncaught exceptions during play:')
    for (const e of errors) console.log(`  ${e}`)
    process.exitCode = 1
  } else {
    console.log(`\nPLAYTEST PASSED (${steps.length} checks) — screenshot: ${shotPath}`)
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
