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
import './game/ui/shop.css'

import { Color, Scene } from 'three'

import { GameLoop } from './engine/core/loop.js'
import { SettingsManager } from './engine/core/settings.js'
import { AudioBus } from './engine/audio/audio-bus.js'
import { InputManager, type PointerSurface } from './engine/input/input.js'
import { ensureFontsReady } from './engine/render/fonts.js'
import { guessTier, ThreeRenderer } from './engine/three/renderer.js'
import { ACTION_BINDINGS } from './game/config/actions.js'
import { playClick, playStart } from './game/audio/sfx.js'
import {
  createDefaultSave,
  createSaveStore,
  exportSaveToFile,
  importSaveFromFile,
  sanitizeSave,
} from './game/save.js'
import { TownScene3D } from './game/scenes/town-scene3d.js'
import { TitleScreen } from './game/ui/title-screen.js'
import { Garage } from './game/ui/garage.js'
import { getVehicle } from './content/vehicles.js'

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
  let town: TownScene3D | null = null
  let started = false

  const titleState = (): Parameters<TitleScreen['refresh']>[0] => ({
    muted: settings.settings.muted,
    reducedMotion: settings.settings.reducedMotion,
    quality: settings.settings.qualityPreference,
    coins: save.coins,
    ownedCount: save.ownedVehicles.length,
  })

  const title = new TitleScreen(app, {
    onPlay: () => start(),
    onGarage: () => {
      // Before the town exists there is no car to swap, so the title screen
      // gets its own garage that edits the save directly. The town reads that
      // save when it starts, so a choice made here is the car you drive.
      playClick(audio)
      titleGarage.refresh({ coins: save.coins, owned: save.ownedVehicles, active: save.activeVehicle })
      titleGarage.setOpen(true)
    },
    onMuteToggle: () => {
      const muted = settings.toggleMute()
      save.muted = muted
      audio.setMuted(muted)
      store.save(save)
      title.refresh(titleState())
    },
    onQualityChange: (tier) => {
      settings.set('qualityPreference', tier)
      if (tier !== 'auto') renderer.setTier(tier)
      title.refresh(titleState())
      playClick(audio)
    },
    onReducedMotionToggle: () => {
      settings.set('reducedMotion', !settings.settings.reducedMotion)
      title.refresh(titleState())
      playClick(audio)
    },
    onExport: () => exportSaveToFile(save),
    onImport: (file) => {
      void importSaveFromFile(file).then((result) => {
        if (!result.ok) {
          title.setStatus(result.reason, 'error')
          return
        }
        Object.assign(save, result.save)
        store.save(save)
        store.flush()
        settings.set('muted', save.muted)
        audio.setMuted(save.muted)
        title.refresh(titleState())
        title.setStatus(result.migrated ? 'Loaded (from an older version).' : 'Loaded!')
      })
    },
    onResetProgress: () => {
      Object.assign(save, createDefaultSave())
      store.save(save)
      store.flush()
      title.refresh(titleState())
      title.setStatus('Started over.')
    },
  })

  const titleGarage = new Garage(app, {
    onBuy: (id) => {
      const def = getVehicle(id)
      if (save.ownedVehicles.includes(def.id) || save.coins < def.price) return false
      save.coins -= def.price
      save.ownedVehicles.push(def.id)
      save.activeVehicle = def.id
      store.save(save)
      titleGarage.refresh({ coins: save.coins, owned: save.ownedVehicles, active: save.activeVehicle })
      title.refresh(titleState())
      return true
    },
    onSelect: (id) => {
      save.activeVehicle = id
      store.save(save)
      titleGarage.refresh({ coins: save.coins, owned: save.ownedVehicles, active: save.activeVehicle })
      playClick(audio)
    },
    onClose: () => {
      titleGarage.setOpen(false)
      playClick(audio)
    },
  })

  title.refresh(titleState())
  hideBootSplash()

  const start = (): void => {
    if (started) return
    started = true

    void audio.resume()
    playStart(audio)

    title.dismiss()
    titleGarage.dispose()
    window.removeEventListener('keydown', onKeyStart)

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

  // Any key starts, so a keyboard player never has to reach for a mouse —
  // except while a dialog is open, where a keypress means something else.
  const onKeyStart = (): void => {
    if (titleGarage.isOpen) return
    start()
  }
  window.addEventListener('keydown', onKeyStart)

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

function hideBootSplash(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('is-hidden')
  setTimeout(() => boot.remove(), 500)
}

void main()
