/**
 * Drives headless Chrome over the DevTools Protocol to verify the game
 * actually boots: captures console output and uncaught exceptions, checks
 * live engine state, and writes a screenshot.
 *
 * Zero dependencies — Node 22 ships a global WebSocket.
 *
 * Usage: node verify.mjs <url> <out.png> [waitMs]
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const url = process.argv[2] ?? 'http://localhost:4173/'
const outPath = process.argv[3] ?? 'shot.png'
const waitMs = Number(process.argv[4] ?? 4000)
const PORT = 9333

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=1024,768',
    // Without this, headless throttles rAF to nothing when it thinks the page
    // is not visible — which is exactly what a game loop needs.
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--run-all-compositor-stages-before-draw',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

let ws
const consoleLines = []
const errors = []
let nextId = 1
const pending = new Map()

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function findTarget() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Chrome not up yet.
    }
    await sleep(200)
  }
  throw new Error('Could not reach Chrome DevTools endpoint')
}

function describeArg(arg) {
  if (arg.value !== undefined) return String(arg.value)
  if (arg.description !== undefined) return arg.description
  if (arg.unserializableValue !== undefined) return arg.unserializableValue
  return arg.type
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

    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? []).map(describeArg).join(' ')
      consoleLines.push(`[${msg.params.type}] ${text}`)
    }

    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      errors.push(d.exception?.description ?? d.text ?? 'unknown exception')
    }

    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      if (e.level === 'error' || e.level === 'warning') {
        errors.push(`[${e.level}] ${e.text}${e.url ? ` (${e.url})` : ''}`)
      }
    }
  })

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')

  await send('Page.navigate', { url })
  await sleep(waitMs)

  // Interrogate live engine state rather than trusting the screenshot alone.
  const probe = await send('Runtime.evaluate', {
    expression: `(() => {
      const g = globalThis.game
      const canvas = document.getElementById('game-canvas')
      return JSON.stringify({
        hasGame: !!g,
        canvasSize: canvas ? [canvas.width, canvas.height] : null,
        bootPresent: !!document.getElementById('boot'),
        titlePresent: !!document.querySelector('.title'),
        hudPresent: !!document.querySelector('.hud'),
        running: g ? g.loop.running : null,
        started: g ? g.started : null,
        fps: g ? Math.round(g.stats.fps) : null,
        updateMs: g ? Number(g.stats.updateMs.toFixed(3)) : null,
        renderMs: g ? Number(g.stats.renderMs.toFixed(3)) : null,
        totalSteps: g ? g.stats.totalSteps : null,
        droppedFrames: g ? g.stats.droppedFrames : null,
        tier: g ? g.renderer.tier : null,
        drawCalls: g ? g.renderStats.calls : null,
        triangles: g ? g.renderStats.triangles : null,
      })
    })()`,
    returnByValue: true,
  })

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(outPath, Buffer.from(shot.data, 'base64'))

  console.log('=== ENGINE STATE ===')
  console.log(JSON.stringify(JSON.parse(probe.result.value), null, 2))

  console.log('\n=== CONSOLE ===')
  console.log(consoleLines.length ? consoleLines.join('\n') : '(none)')

  console.log('\n=== ERRORS / WARNINGS ===')
  console.log(errors.length ? errors.join('\n') : '(none)')

  console.log(`\nScreenshot written to ${outPath}`)
  process.exitCode = errors.length > 0 ? 1 : 0
} catch (error) {
  console.error('verify failed:', error)
  process.exitCode = 2
} finally {
  try {
    ws?.close()
  } catch {
    // Ignore.
  }
  chrome.kill()
}
