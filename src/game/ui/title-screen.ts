/**
 * The title screen.
 *
 * One enormous Play button, and a row of smaller icon buttons beneath it for
 * everything else. That hierarchy matters: a non-reader needs the way *in* to
 * be unmistakable, and a screen of equal-weight options is a screen with no
 * obvious way in at all.
 *
 * The secondary row is text-free — garage, sound, help — and the settings and
 * save-file controls sit inside the help/settings sheet rather than on the
 * front, because they are parent-facing and a child tapping them by accident
 * should not change anything they care about.
 */

import { BRANDING } from '../config/branding.js'
import { VEHICLES_BY_PRICE } from '../../content/vehicles.js'

export interface TitleCallbacks {
  onPlay(): void
  onGarage(): void
  onMuteToggle(): void
  onQualityChange(tier: 'low' | 'medium' | 'high' | 'auto'): void
  onReducedMotionToggle(): void
  onExport(): void
  onImport(file: File): void
  onResetProgress(): void
}

export interface TitleState {
  muted: boolean
  reducedMotion: boolean
  quality: 'low' | 'medium' | 'high' | 'auto'
  coins: number
  ownedCount: number
}

export class TitleScreen {
  readonly element: HTMLDivElement

  readonly #callbacks: TitleCallbacks
  readonly #muteButton: HTMLButtonElement
  readonly #sheet: HTMLDivElement
  readonly #fileInput: HTMLInputElement
  readonly #status: HTMLParagraphElement
  readonly #stats: HTMLDivElement

  #sheetOpen = false

  constructor(container: HTMLElement, callbacks: TitleCallbacks) {
    this.#callbacks = callbacks

    this.element = document.createElement('div')
    this.element.className = 'title'

    const heading = document.createElement('h1')
    heading.className = 'title-name'
    // textContent, not innerHTML: this is data and can never inject markup.
    heading.textContent = BRANDING.title
    this.element.appendChild(heading)

    const play = document.createElement('button')
    play.className = 'title-play'
    play.type = 'button'
    play.setAttribute('aria-label', 'Play')
    play.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M25 16l26 16-26 16z" fill="currentColor"/></svg>`
    play.addEventListener('click', () => this.#callbacks.onPlay())
    this.element.appendChild(play)

    // -- Secondary options ---------------------------------------------------
    const row = document.createElement('div')
    row.className = 'title-options'

    const garage = this.#makeOption(
      'Garage',
      `<svg viewBox="0 0 32 32"><path d="M4 15L16 6l12 9v12a1 1 0 01-1 1H5a1 1 0 01-1-1z" fill="currentColor"/><rect x="9" y="19" width="14" height="9" rx="1.5" fill="#1e3350"/></svg>`,
    )
    garage.addEventListener('click', () => this.#callbacks.onGarage())
    row.appendChild(garage)

    this.#muteButton = this.#makeOption(
      'Sound on or off',
      `<svg viewBox="0 0 32 32"><path d="M7 12h5l6-5v18l-6-5H7z" fill="currentColor"/><g class="title-waves"><path d="M21 12a6 6 0 010 8" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M24.5 9a10 10 0 010 14" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/></g><path class="title-slash" d="M8 24L26 8" stroke="#ff8c42" stroke-width="3.4" stroke-linecap="round"/></svg>`,
    )
    this.#muteButton.addEventListener('click', () => this.#callbacks.onMuteToggle())
    row.appendChild(this.#muteButton)

    const settings = this.#makeOption(
      'Settings',
      `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M7 7l3 3M22 22l3 3M25 7l-3 3M10 22l-3 3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    )
    settings.addEventListener('click', () => this.#toggleSheet())
    row.appendChild(settings)

    this.element.appendChild(row)

    // Progress summary, so a returning player sees their stuff immediately.
    this.#stats = document.createElement('div')
    this.#stats.className = 'title-stats'
    this.element.appendChild(this.#stats)

    // -- Settings sheet --------------------------------------------------------
    this.#sheet = document.createElement('div')
    this.#sheet.className = 'title-sheet is-hidden'
    this.#sheet.innerHTML = SHEET_TEMPLATE
    this.element.appendChild(this.#sheet)

    ;(this.#sheet.querySelector('.title-sheet-close') as HTMLButtonElement).addEventListener(
      'click',
      () => this.#toggleSheet(),
    )

    for (const button of this.#sheet.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
      button.addEventListener('click', () => {
        const tier = button.dataset['quality'] as TitleState['quality']
        this.#callbacks.onQualityChange(tier)
      })
    }

    ;(this.#sheet.querySelector('.title-motion') as HTMLButtonElement).addEventListener(
      'click',
      () => this.#callbacks.onReducedMotionToggle(),
    )
    ;(this.#sheet.querySelector('.title-export') as HTMLButtonElement).addEventListener(
      'click',
      () => this.#callbacks.onExport(),
    )

    this.#fileInput = this.#sheet.querySelector('.title-file') as HTMLInputElement
    ;(this.#sheet.querySelector('.title-import') as HTMLButtonElement).addEventListener(
      'click',
      () => this.#fileInput.click(),
    )
    this.#fileInput.addEventListener('change', () => {
      const file = this.#fileInput.files?.[0]
      if (file) this.#callbacks.onImport(file)
      this.#fileInput.value = ''
    })

    const reset = this.#sheet.querySelector('.title-reset') as HTMLButtonElement
    reset.addEventListener('click', () => {
      // Two taps to wipe progress. Destructive and irreversible, so it must
      // not be reachable by one stray finger.
      if (reset.classList.contains('is-armed')) {
        reset.classList.remove('is-armed')
        this.#callbacks.onResetProgress()
      } else {
        reset.classList.add('is-armed')
        setTimeout(() => reset.classList.remove('is-armed'), 4000)
      }
    })

    this.#status = this.#sheet.querySelector('.title-status') as HTMLParagraphElement

    container.appendChild(this.element)
  }

  /** Reflect current settings and progress. */
  refresh(state: TitleState): void {
    this.#muteButton.classList.toggle('is-muted', state.muted)

    for (const button of this.#sheet.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
      button.classList.toggle('is-selected', button.dataset['quality'] === state.quality)
    }

    const motion = this.#sheet.querySelector('.title-motion') as HTMLButtonElement
    motion.classList.toggle('is-selected', state.reducedMotion)

    this.#stats.innerHTML = `
      <span class="title-stat">
        <svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#e0a800"/><circle cx="16" cy="14.8" r="11.5" fill="#ffc93c"/></svg>
        ${state.coins}
      </span>
      <span class="title-stat">
        <svg viewBox="0 0 32 32"><path d="M3 20h26M6 20v-6l4-5h12l5 5v6" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round"/></svg>
        ${state.ownedCount}/${VEHICLES_BY_PRICE.length}
      </span>`
  }

  setStatus(message: string, kind: 'ok' | 'error' = 'ok'): void {
    this.#status.textContent = message
    this.#status.classList.toggle('is-error', kind === 'error')
  }

  /** Play the leave animation, then remove. */
  dismiss(): void {
    this.element.classList.add('is-leaving')
    setTimeout(() => this.element.remove(), 420)
  }

  #toggleSheet(): void {
    this.#sheetOpen = !this.#sheetOpen
    this.#sheet.classList.toggle('is-hidden', !this.#sheetOpen)
    if (!this.#sheetOpen) this.#status.textContent = ''
  }

  #makeOption(label: string, svg: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'title-option'
    button.setAttribute('aria-label', label)
    button.innerHTML = svg
    return button
  }
}

const SHEET_TEMPLATE = `
<div class="title-sheet-panel">
  <button class="title-sheet-close" type="button" aria-label="Close">
    <svg viewBox="0 0 32 32"><path d="M9 9l14 14M23 9L9 23" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>
  </button>

  <p class="title-sheet-label">Picture quality</p>
  <div class="title-choices">
    <button type="button" data-quality="auto">Auto</button>
    <button type="button" data-quality="low">Low</button>
    <button type="button" data-quality="medium">Medium</button>
    <button type="button" data-quality="high">High</button>
  </div>

  <p class="title-sheet-label">Motion</p>
  <button class="title-motion title-wide" type="button">Gentler movement</button>

  <p class="title-sheet-label">Saved game</p>
  <div class="title-choices">
    <button class="title-export" type="button">Save to file</button>
    <button class="title-import" type="button">Load file</button>
  </div>
  <input class="title-file" type="file" accept="application/json,.json" />

  <button class="title-reset title-wide" type="button">Start over</button>
  <p class="title-status"></p>
</div>
`
