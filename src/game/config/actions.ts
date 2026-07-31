/**
 * Named input actions and their keyboard/gamepad bindings.
 *
 * Touch is deliberately absent here: on a tablet the controls are drawn,
 * on-screen, positional widgets rather than abstract buttons, so they read
 * raw pointers directly. This map exists so the desktop and gamepad paths
 * feed the *same* named actions that the touch controls produce, and
 * gameplay never has to know which device is in use.
 */

import type { ActionMap } from '../../engine/input/input.js'

export const ACTION_BINDINGS = {
  /** Drive forward. */
  accelerate: {
    keys: ['ArrowUp', 'KeyW', 'Space'],
    gamepadButtons: [0, 7],
    gamepadAxis: [1, -1],
  },

  /** Brake and, held at a standstill, reverse. */
  brake: {
    keys: ['ArrowDown', 'KeyS'],
    gamepadButtons: [1, 6],
    gamepadAxis: [1, 1],
  },

  steerLeft: {
    keys: ['ArrowLeft', 'KeyA'],
    gamepadButtons: [14],
    gamepadAxis: [0, -1],
  },

  steerRight: {
    keys: ['ArrowRight', 'KeyD'],
    gamepadButtons: [15],
    gamepadAxis: [0, 1],
  },

  /** Pure fun: makes a noise, scatters birds, delights a 6-year-old. */
  horn: {
    keys: ['KeyH', 'ShiftLeft'],
    gamepadButtons: [2],
  },

  /** Confirm in menus. */
  confirm: {
    keys: ['Enter', 'Space'],
    gamepadButtons: [0],
  },

  /** Back out of a panel. Never quits the game. */
  back: {
    keys: ['Escape', 'Backspace'],
    gamepadButtons: [1],
  },

  /** Open the garage/shop. */
  garage: {
    keys: ['KeyG', 'Tab'],
    gamepadButtons: [3],
  },

  /** Mute toggle — reachable without entering a menu. */
  mute: {
    keys: ['KeyM'],
  },

  /** Debug overlay, development builds only. */
  debug: {
    keys: ['Backquote'],
  },
} as const satisfies ActionMap

export type ActionName = keyof typeof ACTION_BINDINGS
