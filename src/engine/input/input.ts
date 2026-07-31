/**
 * Unified input.
 *
 * Gameplay never touches raw DOM events. It asks this layer questions like
 * "how hard is the player steering?" and "is the go button held?", and the
 * layer answers from whichever device the child happens to be using —
 * touchscreen, mouse, keyboard, or gamepad. That indirection is what lets one
 * control implementation serve a tablet and a laptop without branching.
 *
 * Two concepts:
 * - **Pointers**: raw multi-touch/mouse state, for anything positional
 *   (tapping a passenger, dragging a steering zone, pressing a UI button).
 * - **Actions**: named, device-agnostic axes and buttons that gameplay reads.
 */

import { clamp } from '../math/scalar.js'
import { type Vec2, vec2 } from '../math/vec2.js'
import type { Viewport } from '../render/viewport.js'

export interface PointerState {
  /** Stable id: the touch identifier, or a constant for the mouse. */
  id: number
  /** Position in CSS-pixel canvas space. */
  readonly position: Vec2
  /** Position when this pointer went down. */
  readonly startPosition: Vec2
  /** Movement since the previous frame. */
  readonly delta: Vec2
  /** Total movement since press. */
  readonly dragged: Vec2
  /** True on the frame the pointer went down. */
  justPressed: boolean
  /** True while held. */
  pressed: boolean
  /** True on the frame the pointer came up. */
  justReleased: boolean
  /** Seconds this pointer has been held. */
  heldTime: number
  /** True once movement exceeded the drag threshold — distinguishes tap from drag. */
  isDrag: boolean
  /** 'touch' | 'mouse' | 'pen' */
  type: string
}

/** Which physical inputs feed a named action. */
export interface ActionBinding {
  /** Keyboard `KeyboardEvent.code` values that press this action. */
  keys?: readonly string[]
  /** Gamepad button indices (standard mapping). */
  gamepadButtons?: readonly number[]
  /**
   * Gamepad axis feeding an analogue action, as `[axisIndex, sign]`. Sign
   * selects direction, so a single stick axis can drive two opposed actions.
   */
  gamepadAxis?: readonly [number, number]
}

export type ActionMap = Record<string, ActionBinding>

interface ActionState {
  pressed: boolean
  justPressed: boolean
  justReleased: boolean
  /** 0..1. Digital sources report 0 or 1; gamepad axes report analogue values. */
  value: number
  heldTime: number
}

const MOUSE_POINTER_ID = -1

/** Movement in CSS px before a press is reclassified from tap to drag. */
const DRAG_THRESHOLD = 10

export class InputManager {
  readonly #viewport: Viewport
  readonly #target: HTMLElement

  readonly #pointers = new Map<number, PointerState>()
  /** Pointers released this frame, kept until the next `update` so gameplay sees the release. */
  readonly #releasedPointers: PointerState[] = []

  readonly #keysDown = new Set<string>()
  readonly #keysPressedThisFrame = new Set<string>()
  readonly #keysReleasedThisFrame = new Set<string>()

  readonly #actions = new Map<string, ActionState>()
  #bindings: ActionMap = {}

  /** Index of the gamepad we're listening to, or null. */
  #gamepadIndex: number | null = null

  /** Which device the player most recently used, for showing the right prompts. */
  #lastDevice: 'touch' | 'mouse' | 'keyboard' | 'gamepad' = 'touch'

  #disposed = false
  #enabled = true

  constructor(viewport: Viewport, bindings: ActionMap = {}) {
    this.#viewport = viewport
    this.#target = viewport.canvas
    this.setBindings(bindings)
    this.#attach()
  }

  get lastDevice(): 'touch' | 'mouse' | 'keyboard' | 'gamepad' {
    return this.#lastDevice
  }

  /** True if the player has ever used touch — used to pick the default HUD layout. */
  get hasTouch(): boolean {
    return this.#lastDevice === 'touch'
  }

  /**
   * Suspend input handling (e.g. during a cutscene). Held state is released so
   * the car doesn't keep driving.
   */
  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return
    this.#enabled = enabled
    if (!enabled) this.#releaseAll()
  }

  setBindings(bindings: ActionMap): void {
    this.#bindings = bindings
    this.#actions.clear()
    for (const name of Object.keys(bindings)) {
      this.#actions.set(name, {
        pressed: false,
        justPressed: false,
        justReleased: false,
        value: 0,
        heldTime: 0,
      })
    }
  }

  // ---------------------------------------------------------------- actions

  isDown(action: string): boolean {
    return this.#actions.get(action)?.pressed ?? false
  }

  justPressed(action: string): boolean {
    return this.#actions.get(action)?.justPressed ?? false
  }

  justReleased(action: string): boolean {
    return this.#actions.get(action)?.justReleased ?? false
  }

  /** 0..1 analogue strength. */
  getValue(action: string): number {
    return this.#actions.get(action)?.value ?? 0
  }

  heldTime(action: string): number {
    return this.#actions.get(action)?.heldTime ?? 0
  }

  /**
   * A -1..1 axis from two opposed actions. Gamepad sticks contribute their
   * analogue value; keys contribute full deflection.
   */
  getAxis(negative: string, positive: string): number {
    return clamp(this.getValue(positive) - this.getValue(negative), -1, 1)
  }

  // --------------------------------------------------------------- pointers

  /** All currently-held pointers, plus any released this frame. */
  get pointers(): readonly PointerState[] {
    return [...this.#pointers.values(), ...this.#releasedPointers]
  }

  get pointerCount(): number {
    return this.#pointers.size
  }

  /** The oldest active pointer — the "primary" finger or the mouse. */
  getPrimaryPointer(): PointerState | null {
    for (const p of this.#pointers.values()) return p
    return this.#releasedPointers[0] ?? null
  }

  getPointer(id: number): PointerState | null {
    return this.#pointers.get(id) ?? this.#releasedPointers.find((p) => p.id === id) ?? null
  }

  /** Pointers that went down this frame — the basis for tap handling. */
  getJustPressedPointers(): PointerState[] {
    const result: PointerState[] = []
    for (const p of this.#pointers.values()) if (p.justPressed) result.push(p)
    // Include same-frame press-and-release taps (see anyInputJustPressed).
    for (const p of this.#releasedPointers) if (p.justPressed) result.push(p)
    return result
  }

  /** Pointers released this frame that never exceeded the drag threshold. */
  getTaps(): PointerState[] {
    return this.#releasedPointers.filter((p) => !p.isDrag)
  }

  // -------------------------------------------------------------- keyboard

  isKeyDown(code: string): boolean {
    return this.#keysDown.has(code)
  }

  wasKeyPressed(code: string): boolean {
    return this.#keysPressedThisFrame.has(code)
  }

  wasKeyReleased(code: string): boolean {
    return this.#keysReleasedThisFrame.has(code)
  }

  /** True if any key, button, or pointer went down this frame. Used by "press anything" prompts. */
  anyInputJustPressed(): boolean {
    if (this.#keysPressedThisFrame.size > 0) return true
    for (const p of this.#pointers.values()) if (p.justPressed) return true
    // A fast tap can press AND release between two frames; the pointer is
    // already in the released list but its justPressed flag is still set.
    // Missing this drops quick taps entirely — the worst possible bug on a
    // "tap anywhere to start" screen.
    for (const p of this.#releasedPointers) if (p.justPressed) return true
    for (const state of this.#actions.values()) if (state.justPressed) return true
    return false
  }

  // ----------------------------------------------------------------- frame

  /**
   * Fold this frame's raw events into action state and clear one-frame flags.
   * Must be called exactly once per frame, before gameplay reads input.
   */
  update(dt: number): void {
    this.#pollGamepad(dt)

    for (const [name, binding] of Object.entries(this.#bindings)) {
      const state = this.#actions.get(name)
      if (!state) continue

      let value = 0

      if (binding.keys) {
        for (const code of binding.keys) {
          if (this.#keysDown.has(code)) {
            value = 1
            break
          }
        }
      }

      if (value < 1 && binding.gamepadButtons) {
        const pad = this.#getGamepad()
        if (pad) {
          for (const index of binding.gamepadButtons) {
            const button = pad.buttons[index]
            if (button?.pressed) {
              value = Math.max(value, button.value || 1)
              break
            }
          }
        }
      }

      if (value < 1 && binding.gamepadAxis) {
        const pad = this.#getGamepad()
        if (pad) {
          const [axisIndex, sign] = binding.gamepadAxis
          const raw = pad.axes[axisIndex] ?? 0
          const directed = raw * sign
          // Sticks rest slightly off-centre; ignore the noise floor.
          if (directed > 0.15) {
            value = Math.max(value, clamp((directed - 0.15) / 0.85, 0, 1))
          }
        }
      }

      const wasPressed = state.pressed
      const isPressed = value > 0

      state.value = value
      state.pressed = isPressed
      state.justPressed = isPressed && !wasPressed
      state.justReleased = !isPressed && wasPressed
      state.heldTime = isPressed ? state.heldTime + dt : 0
    }

    for (const pointer of this.#pointers.values()) {
      pointer.heldTime += dt
    }
  }

  /**
   * Clear per-frame edge state. Call at the *end* of the frame, after all
   * systems have read input.
   */
  postUpdate(): void {
    this.#keysPressedThisFrame.clear()
    this.#keysReleasedThisFrame.clear()
    this.#releasedPointers.length = 0

    for (const pointer of this.#pointers.values()) {
      pointer.justPressed = false
      pointer.justReleased = false
      pointer.delta.x = 0
      pointer.delta.y = 0
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const t = this.#target
    t.removeEventListener('pointerdown', this.#onPointerDown)
    t.removeEventListener('pointermove', this.#onPointerMove)
    t.removeEventListener('pointerup', this.#onPointerUp)
    t.removeEventListener('pointercancel', this.#onPointerUp)
    t.removeEventListener('contextmenu', this.#onContextMenu)
    window.removeEventListener('keydown', this.#onKeyDown)
    window.removeEventListener('keyup', this.#onKeyUp)
    window.removeEventListener('blur', this.#onBlur)
    window.removeEventListener('gamepadconnected', this.#onGamepadConnected)
    window.removeEventListener('gamepaddisconnected', this.#onGamepadDisconnected)
  }

  // -------------------------------------------------------------- internals

  #attach(): void {
    const t = this.#target
    t.addEventListener('pointerdown', this.#onPointerDown)
    t.addEventListener('pointermove', this.#onPointerMove)
    t.addEventListener('pointerup', this.#onPointerUp)
    t.addEventListener('pointercancel', this.#onPointerUp)
    t.addEventListener('contextmenu', this.#onContextMenu)

    window.addEventListener('keydown', this.#onKeyDown)
    window.addEventListener('keyup', this.#onKeyUp)
    // Losing focus mid-hold would otherwise leave the car driving forever.
    window.addEventListener('blur', this.#onBlur)
    window.addEventListener('gamepadconnected', this.#onGamepadConnected)
    window.addEventListener('gamepaddisconnected', this.#onGamepadDisconnected)
  }

  readonly #onContextMenu = (e: Event): void => {
    // A long-press on a tablet raises the context menu and interrupts play.
    e.preventDefault()
  }

  readonly #onPointerDown = (e: PointerEvent): void => {
    if (!this.#enabled) return
    e.preventDefault()

    this.#lastDevice = e.pointerType === 'touch' ? 'touch' : 'mouse'

    const id = e.pointerType === 'mouse' ? MOUSE_POINTER_ID : e.pointerId
    const pos = this.#viewport.clientToCanvas(e.clientX, e.clientY)

    this.#pointers.set(id, {
      id,
      position: vec2(pos.x, pos.y),
      startPosition: vec2(pos.x, pos.y),
      delta: vec2(),
      dragged: vec2(),
      justPressed: true,
      pressed: true,
      justReleased: false,
      heldTime: 0,
      isDrag: false,
      type: e.pointerType,
    })

    // Keep receiving move/up even if the finger leaves the canvas bounds.
    if (this.#target.setPointerCapture) {
      try {
        this.#target.setPointerCapture(e.pointerId)
      } catch {
        // Capture is best-effort; some browsers reject it for synthetic events.
      }
    }
  }

  readonly #onPointerMove = (e: PointerEvent): void => {
    if (!this.#enabled) return
    const id = e.pointerType === 'mouse' ? MOUSE_POINTER_ID : e.pointerId
    const pointer = this.#pointers.get(id)
    if (!pointer) return

    e.preventDefault()

    const pos = this.#viewport.clientToCanvas(e.clientX, e.clientY)
    pointer.delta.x += pos.x - pointer.position.x
    pointer.delta.y += pos.y - pointer.position.y
    pointer.position.x = pos.x
    pointer.position.y = pos.y
    pointer.dragged.x = pos.x - pointer.startPosition.x
    pointer.dragged.y = pos.y - pointer.startPosition.y

    if (!pointer.isDrag && Math.hypot(pointer.dragged.x, pointer.dragged.y) > DRAG_THRESHOLD) {
      pointer.isDrag = true
    }
  }

  readonly #onPointerUp = (e: PointerEvent): void => {
    const id = e.pointerType === 'mouse' ? MOUSE_POINTER_ID : e.pointerId
    const pointer = this.#pointers.get(id)
    if (!pointer) return

    pointer.pressed = false
    pointer.justReleased = true
    this.#pointers.delete(id)
    this.#releasedPointers.push(pointer)

    if (this.#target.releasePointerCapture) {
      try {
        this.#target.releasePointerCapture(e.pointerId)
      } catch {
        // Already released, or never captured.
      }
    }
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#enabled) return
    // Don't steal keys from a focused text field (the parent-gate input).
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return

    this.#lastDevice = 'keyboard'

    if (!this.#keysDown.has(e.code)) {
      this.#keysPressedThisFrame.add(e.code)
    }
    this.#keysDown.add(e.code)

    // Arrows and space scroll the page by default, which fights the game.
    if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault()
  }

  readonly #onKeyUp = (e: KeyboardEvent): void => {
    if (this.#keysDown.delete(e.code)) {
      this.#keysReleasedThisFrame.add(e.code)
    }
  }

  readonly #onBlur = (): void => {
    this.#releaseAll()
  }

  #releaseAll(): void {
    for (const code of this.#keysDown) this.#keysReleasedThisFrame.add(code)
    this.#keysDown.clear()

    for (const pointer of this.#pointers.values()) {
      pointer.pressed = false
      pointer.justReleased = true
      this.#releasedPointers.push(pointer)
    }
    this.#pointers.clear()
  }

  readonly #onGamepadConnected = (e: Event): void => {
    const gamepadEvent = e as GamepadEvent
    this.#gamepadIndex = gamepadEvent.gamepad.index
  }

  readonly #onGamepadDisconnected = (e: Event): void => {
    const gamepadEvent = e as GamepadEvent
    if (this.#gamepadIndex === gamepadEvent.gamepad.index) {
      this.#gamepadIndex = null
    }
  }

  #getGamepad(): Gamepad | null {
    if (this.#gamepadIndex === null || typeof navigator.getGamepads !== 'function') return null
    return navigator.getGamepads()[this.#gamepadIndex] ?? null
  }

  #pollGamepad(_dt: number): void {
    const pad = this.#getGamepad()
    if (!pad) return
    // Any meaningful deflection counts as "the player picked up the pad".
    for (const button of pad.buttons) {
      if (button.pressed) {
        this.#lastDevice = 'gamepad'
        return
      }
    }
    for (const axis of pad.axes) {
      if (Math.abs(axis) > 0.4) {
        this.#lastDevice = 'gamepad'
        return
      }
    }
  }
}

const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Tab',
])
