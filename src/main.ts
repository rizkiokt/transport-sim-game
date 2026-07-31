/**
 * Entry point.
 *
 * Wires the 3D renderer, input, audio, settings and save store together,
 * shows a title overlay until the child taps, then runs the town.
 *
 * The title is DOM rather than a rendered scene: it needs exactly one
 * unmissable button, and the browser gives us crisp text, real hit-testing and
 * focus handling for free. It also doubles as the WebAudio unlock gesture,
 * which browsers require before any sound can play.
 */

import './game/ui/hud.css'
import './game/ui/title.css'

import { Color, Scene } from 'three'

import { GameLoop } from './engine/core/loop.js'
import { SettingsManager } from './engine/core/settings.js'
import { AudioBus } from './engine/audio/audio-bus.js'
import { InputManager, type PointerSurface } from './engine/input/input.js'
import { ensureFontsReady } from './engine/render/fonts.js'
import { guessTier, ThreeRenderer } from './engine/three/renderer.js'
import { ACTION_BINDINGS } from './game/config/actions.js'
import { BRANDING } from './game/config/branding.js'
import { playStart } from './game/audio/sfx.js'
import { createSaveStore, sanitizeSave } from './game/save.js'
import { TownScene3D } from './game/scenes/town-scene3d.js'

/** Shown for the frames before the town exists, so the start is sky not black. */
function createSkyScene(): Scene {
  const scene = new Scene()
  scene.background = new Color(0x8fd0f0)
  return scene
}

/**
 * Adapts the canvas to what {@link InputManager} needs. In 3D nothing
 * requires canvas-space pointer maths — the HUD handles its own gestures in
 * client coordinates — so this is a thin translation.
 */
function createPointerSurface(canvas: HTMLCanvasElement): PointerSurface {
  return {
    canvas,
    clientToCanvas(clientX, clientY, out = { x: 0, y: 0 }) {
      const rect = canvas.getBoundingClientRect()
      out.x = clientX - rect.left
      out.y = clientY - rect.top
      return out
    },
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas')
  const app = document.getElementById('app')
  if (!(canvas instanceof HTMLCanvasElement) || !app) {
    throw new Error('main: #game-canvas or #app is missing from the document')
  }

  await ensureFontsReady()

  // -- Core services -------------------------------------------------------
  const settings = new SettingsManager()
  const renderer = new ThreeRenderer({ canvas, tier: guessTier() })
  const input = new InputManager(createPointerSurface(canvas), ACTION_BINDINGS)
  const audio = new AudioBus()
  audio.init()

  const store = createSaveStore()
  const save = sanitizeSave(store.load().data)
  settings.set('muted', save.muted)
  audio.setMuted(save.muted)

  const skyScene = createSkyScene()

  // -- Title ----------------------------------------------------------------
  const title = createTitle(app, BRANDING.title)
  hideBootSplash()

  let town: TownScene3D | null = null
  let started = false

  const start = (): void => {
    if (started) return
    started = true

    void audio.resume()
    playStart(audio)

    title.element.classList.add('is-leaving')
    setTimeout(() => title.element.remove(), 420)
    window.removeEventListener('keydown', start)

    town = new TownScene3D({
      renderer,
      input,
      audio,
      settings,
      store,
      save,
      hudContainer: app,
      surface: canvas,
    })
  }

  title.playButton.addEventListener('click', start)
  // Any key also starts, so a keyboard player never has to reach for a mouse.
  window.addEventListener('keydown', start)

  // -- Loop -------------------------------------------------------------------
  const loop = new GameLoop(
    {
      update: (dt) => {
        input.update(dt)
        town?.update(dt)
        input.postUpdate()
      },
      render: (_alpha, frameDt) => {
        settings.observeFrameRate(loop.stats.fps, frameDt)
        if (town) town.render()
        else renderer.render(skyScene)
      },
    },
    { updateHz: 60 },
  )

  // Quality changes have to reach the renderer, which owns pixel ratio and
  // shadow state.
  settings.events.on('qualityChanged', ({ tier }) => renderer.setTier(tier))

  loop.start()

  if (import.meta.env.DEV) {
    ;(globalThis as unknown as Record<string, unknown>)['game'] = {
      loop,
      renderer,
      settings,
      audio,
      start,
      get town() {
        return town
      },
      get started() {
        return started
      },
      get stats() {
        return loop.stats
      },
      get renderStats() {
        return renderer.stats
      },
    }
  }
}

interface TitleHandle {
  element: HTMLDivElement
  playButton: HTMLButtonElement
}

function createTitle(container: HTMLElement, name: string): TitleHandle {
  const element = document.createElement('div')
  element.className = 'title'

  const heading = document.createElement('h1')
  heading.className = 'title-name'
  // textContent, not innerHTML: the title is data, and this can never inject.
  heading.textContent = name

  const button = document.createElement('button')
  button.className = 'title-play'
  button.type = 'button'
  button.setAttribute('aria-label', 'Play')
  button.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M25 16l26 16-26 16z" fill="currentColor"/></svg>`

  element.append(heading, button)
  container.appendChild(element)

  return { element, playButton: button }
}

function hideBootSplash(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('is-hidden')
  setTimeout(() => boot.remove(), 500)
}

void main()
