/**
 * The HUD, built from DOM elements layered over the WebGL canvas.
 *
 * DOM rather than canvas drawing, deliberately: text stays crisp at any DPR
 * without manual scaling, buttons get real hit-testing and focus handling for
 * free, and none of it costs WebGL draw calls. The only rule is that nothing
 * here may block pointer events destined for the driving surface, so the
 * container is `pointer-events: none` and only the buttons opt back in.
 *
 * Text-free by design. The sole glyphs are digits — a 6-year-old reads
 * numbers long before words — and everything else is a shape.
 */

import { clamp } from '../../engine/math/scalar.js'

export interface HudCallbacks {
  onMuteToggle(): void
  onHorn(): void
  onShop(): void
  onGarage(): void
}

/** Drag distances in CSS px for full steering / brake engagement. */
const STEER_FULL_DRAG = 90
const BRAKE_DRAG = 75

export class Hud3D {
  /** Driving intent produced by touch, read by the scene each frame. */
  touchThrottle = 0
  touchSteer = 0
  touchBrake = 0

  readonly #root: HTMLDivElement
  readonly #coinValue: HTMLSpanElement
  readonly #coinPill: HTMLDivElement
  readonly #muteButton: HTMLButtonElement
  readonly #shopButton!: HTMLButtonElement
  readonly #garageButton!: HTMLButtonElement
  readonly #compass: HTMLDivElement
  readonly #compassArrow: HTMLDivElement
  readonly #stick: HTMLDivElement
  readonly #stickKnob: HTMLDivElement

  readonly #callbacks: HudCallbacks
  readonly #surface: HTMLElement

  #displayedCoins = 0
  #targetCoins = 0

  /** The pointer currently driving, if any. */
  #drivePointerId: number | null = null
  #driveStartX = 0
  #driveStartY = 0

  #disposed = false

  constructor(container: HTMLElement, surface: HTMLElement, callbacks: HudCallbacks, initialCoins: number) {
    this.#callbacks = callbacks
    this.#surface = surface
    this.#displayedCoins = initialCoins
    this.#targetCoins = initialCoins

    this.#root = document.createElement('div')
    this.#root.className = 'hud'
    this.#root.innerHTML = TEMPLATE
    container.appendChild(this.#root)

    this.#coinPill = this.#root.querySelector('.hud-coins') as HTMLDivElement
    this.#coinValue = this.#root.querySelector('.hud-coins-value') as HTMLSpanElement
    this.#muteButton = this.#root.querySelector('.hud-mute') as HTMLButtonElement
    this.#compass = this.#root.querySelector('.hud-compass') as HTMLDivElement
    this.#compassArrow = this.#root.querySelector('.hud-compass-arrow') as HTMLDivElement
    this.#stick = this.#root.querySelector('.hud-stick') as HTMLDivElement
    this.#stickKnob = this.#root.querySelector('.hud-stick-knob') as HTMLDivElement

    this.#coinValue.textContent = String(initialCoins)

    const hornButton = this.#root.querySelector('.hud-horn') as HTMLButtonElement
    hornButton.addEventListener('pointerdown', this.#onHornPress)
    this.#muteButton.addEventListener('pointerdown', this.#onMutePress)

    this.#shopButton = this.#root.querySelector('.hud-shop') as HTMLButtonElement
    this.#shopButton.addEventListener('pointerdown', this.#onShopPress)

    this.#garageButton = this.#root.querySelector('.hud-garage') as HTMLButtonElement
    this.#garageButton.addEventListener('pointerdown', this.#onGaragePress)

    // Driving pointers are captured on the 3D surface, not the HUD, so
    // buttons naturally take precedence without any hit-test bookkeeping.
    this.#surface.addEventListener('pointerdown', this.#onSurfaceDown)
    this.#surface.addEventListener('pointermove', this.#onSurfaceMove)
    this.#surface.addEventListener('pointerup', this.#onSurfaceUp)
    this.#surface.addEventListener('pointercancel', this.#onSurfaceUp)

    // Release fallbacks. Without these a lost pointerup latches the throttle
    // at full FOREVER and, because the latched pointer id never clears, every
    // subsequent finger is ignored — the child is left holding a car that
    // drives itself and will not respond. Pointer capture can be broken by
    // the browser, a context menu, an OS gesture, or the tab losing focus, so
    // the canvas alone is not a reliable place to hear about the release.
    window.addEventListener('pointerup', this.#onGlobalRelease)
    window.addEventListener('pointercancel', this.#onGlobalRelease)
    window.addEventListener('blur', this.#onLostFocus)
    document.addEventListener('visibilitychange', this.#onVisibilityChange)
  }

  /** Tell the HUD the balance changed; the counter rolls up to meet it. */
  setCoins(coins: number, celebrate: boolean): void {
    this.#targetCoins = coins
    if (celebrate) {
      this.#coinPill.classList.remove('is-pop')
      // Reflow so the animation restarts even on back-to-back deliveries.
      void this.#coinPill.offsetWidth
      this.#coinPill.classList.add('is-pop')
    }
  }

  setMuted(muted: boolean): void {
    this.#muteButton.classList.toggle('is-muted', muted)
  }

  /** Nudge the shop button when something has just become affordable. */
  setShopAffordable(affordable: boolean): void {
    this.#shopButton.classList.toggle('is-affordable', affordable)
  }

  /** The HUD owns the layer everything else (map, shop) mounts into. */
  get layer(): HTMLElement {
    return this.#root
  }

  /**
   * Point the compass toward a world target.
   *
   * @param screenAngle radians, where 0 is straight up on screen.
   * @param visible false hides the compass entirely (no active ride).
   * @param onScreen true when the target is already comfortably in frame, in
   *   which case the compass fades out — the beacon itself is guidance enough.
   */
  setCompass(screenAngle: number, visible: boolean, onScreen: boolean, color: number): void {
    this.#compass.classList.toggle('is-hidden', !visible || onScreen)
    if (!visible || onScreen) return
    this.#compassArrow.style.transform = `rotate(${screenAngle}rad)`
    this.#compass.style.setProperty('--compass-color', `#${color.toString(16).padStart(6, '0')}`)
  }

  update(dt: number): void {
    // Roll the coin counter toward its target so earnings feel like they
    // accumulate rather than teleport.
    if (this.#displayedCoins !== this.#targetCoins) {
      const diff = this.#targetCoins - this.#displayedCoins
      const step = Math.max(1, Math.abs(diff) * dt * 6)
      this.#displayedCoins =
        Math.abs(diff) <= step
          ? this.#targetCoins
          : this.#displayedCoins + Math.sign(diff) * step
      this.#coinValue.textContent = String(Math.round(this.#displayedCoins))
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#surface.removeEventListener('pointerdown', this.#onSurfaceDown)
    this.#surface.removeEventListener('pointermove', this.#onSurfaceMove)
    this.#surface.removeEventListener('pointerup', this.#onSurfaceUp)
    this.#surface.removeEventListener('pointercancel', this.#onSurfaceUp)
    window.removeEventListener('pointerup', this.#onGlobalRelease)
    window.removeEventListener('pointercancel', this.#onGlobalRelease)
    window.removeEventListener('blur', this.#onLostFocus)
    document.removeEventListener('visibilitychange', this.#onVisibilityChange)
    this.#root.remove()
  }

  // ------------------------------------------------------------- handlers

  readonly #onHornPress = (e: PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.#callbacks.onHorn()
  }

  readonly #onMutePress = (e: PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.#callbacks.onMuteToggle()
  }

  readonly #onShopPress = (e: PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.#callbacks.onShop()
  }

  readonly #onGaragePress = (e: PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.#callbacks.onGarage()
  }

  readonly #onSurfaceDown = (e: PointerEvent): void => {
    // A resting palm or grip-thumb touches down first and, under a
    // first-pointer-wins rule, latches the throttle and locks out the finger
    // the child is actually steering with. The most recent deliberate touch
    // should always be the one driving, so a new pointer takes over.
    this.#drivePointerId = e.pointerId
    this.#driveStartX = e.clientX
    this.#driveStartY = e.clientY
    this.touchThrottle = 1

    try {
      this.#surface.setPointerCapture(e.pointerId)
    } catch {
      // Best-effort; some synthetic events reject capture.
    }

    this.#stick.style.left = `${e.clientX}px`
    this.#stick.style.top = `${e.clientY}px`
    this.#stick.classList.add('is-active')
    this.#stickKnob.style.transform = 'translate(-50%, -50%)'
  }

  readonly #onSurfaceMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.#drivePointerId) return

    const dx = e.clientX - this.#driveStartX
    const dy = e.clientY - this.#driveStartY

    this.touchSteer = clamp(dx / STEER_FULL_DRAG, -1, 1)
    if (dy > BRAKE_DRAG) {
      this.touchBrake = clamp((dy - BRAKE_DRAG) / BRAKE_DRAG, 0, 1)
      this.touchThrottle = 0
    } else {
      this.touchBrake = 0
      this.touchThrottle = 1
    }

    const knobX = clamp(dx, -STEER_FULL_DRAG, STEER_FULL_DRAG) * 0.5
    const knobY = clamp(dy, -30, BRAKE_DRAG * 1.5) * 0.4
    this.#stickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`
  }

  readonly #onSurfaceUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.#drivePointerId) return
    this.#releaseDriving()
  }

  /** Window-level release, for events the canvas never sees. */
  readonly #onGlobalRelease = (e: PointerEvent): void => {
    if (e.pointerId !== this.#drivePointerId) return
    this.#releaseDriving()
  }

  readonly #onLostFocus = (): void => {
    this.#releaseDriving()
  }

  readonly #onVisibilityChange = (): void => {
    if (document.hidden) this.#releaseDriving()
  }

  /** Drop all driving intent. Safe to call when not driving. */
  #releaseDriving(): void {
    this.#drivePointerId = null
    this.touchThrottle = 0
    this.touchSteer = 0
    this.touchBrake = 0
    this.#stick.classList.remove('is-active')
  }
}

/**
 * Icons are inline SVG so they scale crisply and need no files. Every one is
 * a shape, never a word.
 */
const TEMPLATE = `
<div class="hud-coins">
  <svg class="hud-coin-icon" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14" fill="#e0a800"/>
    <circle cx="16" cy="14.5" r="12.5" fill="#ffc93c"/>
    <path d="M16 7l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L7.3 13.4l6.1-.8z" fill="#e0a800"/>
  </svg>
  <span class="hud-coins-value">0</span>
</div>

<button class="hud-mute" type="button" aria-label="Sound on or off">
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M7 12h5l6-5v18l-6-5H7z" fill="currentColor"/>
    <g class="hud-mute-waves">
      <path d="M21 12a6 6 0 010 8" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M24.5 9a10 10 0 010 14" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </g>
    <path class="hud-mute-slash" d="M8 24L26 8" stroke="#ff8c42" stroke-width="3.4" stroke-linecap="round"/>
  </svg>
</button>

<button class="hud-shop" type="button" aria-label="Upgrades">
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M20.5 4a7.5 7.5 0 00-7 10.2L4 23.7 8.3 28l9.5-9.5A7.5 7.5 0 1020.5 4z" fill="currentColor"/>
  </svg>
</button>

<button class="hud-garage" type="button" aria-label="Garage">
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4 15L16 6l12 9v12a1 1 0 01-1 1H5a1 1 0 01-1-1z" fill="currentColor"/>
    <rect x="9" y="19" width="14" height="9" rx="1.5" fill="#fdfbf4"/>
    <path d="M9 22h14M9 25h14" stroke="currentColor" stroke-width="1.6"/>
  </svg>
</button>

<button class="hud-horn" type="button" aria-label="Horn">
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="11" cy="18" r="6" fill="currentColor"/>
    <path d="M15 13c4-2 8-3 12-4v14c-4-1-8-2-12-4z" fill="currentColor"/>
  </svg>
</button>

<div class="hud-compass is-hidden">
  <div class="hud-compass-arrow">
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3l9 20-9-5-9 5z" fill="currentColor"/>
    </svg>
  </div>
</div>

<div class="hud-stick"><div class="hud-stick-knob"></div></div>
`
