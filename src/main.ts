/**
 * Entry point.
 *
 * Boots the engine, loads the save, hands the title scene to the loop, and
 * removes the HTML loading splash once a frame has actually rendered — so
 * the child never sees a flash of black between the splash disappearing and
 * the game appearing.
 */

import { Game } from './engine/core/game.js'
import { ensureFontsReady } from './engine/render/fonts.js'
import { ACTION_BINDINGS } from './game/config/actions.js'
import { createSaveStore, sanitizeSave } from './game/save.js'
import { TitleScene } from './game/scenes/title-scene.js'

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas')
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('main: #game-canvas is missing from the document')
  }

  // Canvas text silently falls back if the font is not loaded yet, and never
  // repaints when it arrives. Waiting here costs a few hundred milliseconds
  // and is bounded, so a stalled font cannot block startup.
  await ensureFontsReady()

  const store = createSaveStore()
  const loaded = store.load()
  const save = sanitizeSave(loaded.data)

  const game = new Game({
    canvas,
    actions: ACTION_BINDINGS,
    updateHz: 60,
    particleCapacity: 1400,
    initialSettings: { muted: save.muted },
  })

  game.start(new TitleScene(game, store, save))

  // Wait two frames so the splash only disappears after real content is up.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const boot = document.getElementById('boot')
      if (!boot) return
      boot.classList.add('is-hidden')
      // Remove rather than leave a transparent overlay swallowing taps.
      setTimeout(() => boot.remove(), 500)
    })
  })

  // Expose for the debug console in development builds only.
  if (import.meta.env.DEV) {
    ;(globalThis as unknown as { game: Game }).game = game
  }
}

void main()
