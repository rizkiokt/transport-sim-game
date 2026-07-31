/**
 * The upgrade shop.
 *
 * Text-free: each track is an icon, a row of level pips, and a price next to a
 * coin. A 6-year-old reads "5 pips, 3 filled, costs 30" without a word of
 * English, and the buy button simply disables itself when they cannot afford
 * it rather than explaining why.
 *
 * Nothing here can be got wrong. Every upgrade improves the car, none of them
 * conflict, and there is no confirmation step — the worst outcome of a
 * mis-tap is owning a slightly faster taxi.
 *
 * The save export/import controls live at the bottom, deliberately small and
 * out of the way: they are for a parent, not the player.
 */

import { UPGRADES, upgradeCost, type UpgradeDef } from '../../content/upgrades.js'

export interface ShopCallbacks {
  /** Returns true when the purchase succeeded. */
  onBuy(id: string): boolean
  onExport(): void
  onImport(file: File): void
  onClose(): void
}

/** Inline SVG icons. Each has to be legible at 40px and mean something to a child. */
const ICONS: Record<string, string> = {
  // A speedometer needle pinned to the right.
  speed: `<svg viewBox="0 0 48 48"><path d="M6 34a18 18 0 1136 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M24 34L36 18" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="34" r="4" fill="currentColor"/></svg>`,
  // A lightning bolt for acceleration.
  boost: `<svg viewBox="0 0 48 48"><path d="M27 4L11 27h10l-3 17 17-24H24z" fill="currentColor"/></svg>`,
  // A steering wheel.
  grip: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="24" cy="24" r="5" fill="currentColor"/><path d="M24 6v13M8 32l13-6M40 32l-13-6" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>`,
  // A coin with a plus.
  fare: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" fill="currentColor"/><path d="M24 14v20M14 24h20" stroke="#1c2a45" stroke-width="5" stroke-linecap="round"/></svg>`,
}

export class Shop {
  readonly element: HTMLDivElement

  readonly #callbacks: ShopCallbacks
  readonly #rows = new Map<string, HTMLDivElement>()
  readonly #fileInput: HTMLInputElement
  readonly #status: HTMLParagraphElement

  #open = false

  constructor(container: HTMLElement, callbacks: ShopCallbacks) {
    this.#callbacks = callbacks

    this.element = document.createElement('div')
    this.element.className = 'shop is-hidden'
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-label', 'Upgrades')

    const panel = document.createElement('div')
    panel.className = 'shop-panel'
    this.element.appendChild(panel)

    const close = document.createElement('button')
    close.className = 'shop-close'
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.innerHTML = `<svg viewBox="0 0 32 32"><path d="M9 9l14 14M23 9L9 23" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>`
    close.addEventListener('click', () => this.#callbacks.onClose())
    panel.appendChild(close)

    const list = document.createElement('div')
    list.className = 'shop-list'
    panel.appendChild(list)

    for (const def of UPGRADES) {
      list.appendChild(this.#buildRow(def))
    }

    // -- Parent controls -----------------------------------------------------
    const tools = document.createElement('div')
    tools.className = 'shop-tools'

    const exportBtn = document.createElement('button')
    exportBtn.type = 'button'
    exportBtn.className = 'shop-tool'
    exportBtn.setAttribute('aria-label', 'Save game to a file')
    exportBtn.innerHTML = `<svg viewBox="0 0 32 32"><path d="M16 4v16m0 0l-6-6m6 6l6-6" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 22v4a2 2 0 002 2h18a2 2 0 002-2v-4" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg><span>Save to file</span>`
    exportBtn.addEventListener('click', () => this.#callbacks.onExport())
    tools.appendChild(exportBtn)

    const importBtn = document.createElement('button')
    importBtn.type = 'button'
    importBtn.className = 'shop-tool'
    importBtn.setAttribute('aria-label', 'Load game from a file')
    importBtn.innerHTML = `<svg viewBox="0 0 32 32"><path d="M16 20V4m0 0l-6 6m6-6l6 6" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 22v4a2 2 0 002 2h18a2 2 0 002-2v-4" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg><span>Load file</span>`
    importBtn.addEventListener('click', () => this.#fileInput.click())
    tools.appendChild(importBtn)

    this.#fileInput = document.createElement('input')
    this.#fileInput.type = 'file'
    this.#fileInput.accept = 'application/json,.json'
    this.#fileInput.className = 'shop-file'
    this.#fileInput.addEventListener('change', () => {
      const file = this.#fileInput.files?.[0]
      if (file) this.#callbacks.onImport(file)
      // Reset so choosing the same file twice still fires a change event.
      this.#fileInput.value = ''
    })
    tools.appendChild(this.#fileInput)

    panel.appendChild(tools)

    this.#status = document.createElement('p')
    this.#status.className = 'shop-status'
    panel.appendChild(this.#status)

    // Tapping the backdrop closes, which is the gesture a child will try first.
    this.element.addEventListener('pointerdown', (e) => {
      if (e.target === this.element) this.#callbacks.onClose()
    })

    container.appendChild(this.element)
  }

  get isOpen(): boolean {
    return this.#open
  }

  setOpen(open: boolean): void {
    this.#open = open
    this.element.classList.toggle('is-hidden', !open)
    if (!open) this.#status.textContent = ''
  }

  /** Show a short message — used for import results. */
  setStatus(message: string, kind: 'ok' | 'error' = 'ok'): void {
    this.#status.textContent = message
    this.#status.classList.toggle('is-error', kind === 'error')
  }

  /** Refresh prices, pips and affordability. */
  refresh(coins: number, levels: Readonly<Record<string, number>>): void {
    for (const def of UPGRADES) {
      const row = this.#rows.get(def.id)
      if (!row) continue

      const level = levels[def.id] ?? 0
      const cost = upgradeCost(def, level)

      const pips = row.querySelectorAll('.shop-pip')
      pips.forEach((pip, i) => pip.classList.toggle('is-filled', i < level))

      const buy = row.querySelector('.shop-buy') as HTMLButtonElement
      const price = row.querySelector('.shop-price') as HTMLSpanElement

      if (cost === null) {
        row.classList.add('is-maxed')
        buy.disabled = true
        price.textContent = '★'
      } else {
        row.classList.remove('is-maxed')
        price.textContent = String(cost)
        buy.disabled = coins < cost
      }
    }
  }

  dispose(): void {
    this.element.remove()
  }

  #buildRow(def: UpgradeDef): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'shop-row'

    const icon = document.createElement('div')
    icon.className = `shop-icon shop-icon--${def.id}`
    icon.innerHTML = ICONS[def.id] ?? ''
    row.appendChild(icon)

    const pips = document.createElement('div')
    pips.className = 'shop-pips'
    for (let i = 0; i < def.maxLevel; i++) {
      const pip = document.createElement('span')
      pip.className = 'shop-pip'
      pips.appendChild(pip)
    }
    row.appendChild(pips)

    const buy = document.createElement('button')
    buy.type = 'button'
    buy.className = 'shop-buy'
    buy.setAttribute('aria-label', `Upgrade ${def.name}`)
    buy.innerHTML = `<svg class="shop-coin" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#e0a800"/><circle cx="16" cy="14.8" r="11.5" fill="#ffc93c"/></svg><span class="shop-price"></span>`
    buy.addEventListener('click', () => {
      if (this.#callbacks.onBuy(def.id)) {
        buy.classList.remove('is-bought')
        void buy.offsetWidth
        buy.classList.add('is-bought')
      }
    })
    row.appendChild(buy)

    this.#rows.set(def.id, row)
    return row
  }
}
