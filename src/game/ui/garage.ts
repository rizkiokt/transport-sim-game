/**
 * The garage: browse, buy and choose vehicles.
 *
 * One card per vehicle, showing a silhouette, how many people it carries, and
 * either a price, a "choose" button, or a tick if it is already the current
 * car. A 6-year-old can read all three states without a word of English.
 *
 * Locked vehicles are shown, not hidden. Seeing the monster truck you cannot
 * yet afford is the entire reason to keep driving, and hiding it would remove
 * the goal along with the frustration.
 */

import { VEHICLES_BY_PRICE, type VehicleDef } from '../../content/vehicles.js'

export interface GarageCallbacks {
  /** Returns true when the purchase succeeded. */
  onBuy(id: string): boolean
  onSelect(id: string): void
  onClose(): void
}

export interface GarageState {
  coins: number
  owned: readonly string[]
  active: string
}

/**
 * A side-on silhouette per vehicle, drawn as inline SVG.
 *
 * These are hand-tuned to match each 3D model's proportions — a child picks a
 * car by shape, so the icon has to be recognisably the thing they will drive.
 * viewBox is a consistent 100x44 so every card reads at the same scale.
 */
const SILHOUETTES: Record<string, string> = {
  taxi: `<path d="M8 30h84M14 30c0-9 5-11 12-12l7-7h26l9 7c8 1 12 4 12 12" fill="currentColor"/><rect x="40" y="6" width="14" height="5" rx="2" fill="currentColor"/><circle cx="28" cy="33" r="7" fill="#2b2b33"/><circle cx="72" cy="33" r="7" fill="#2b2b33"/>`,
  van: `<path d="M10 30h80M14 30V14c0-3 2-5 5-5h44l16 12v9" fill="currentColor"/><circle cx="30" cy="33" r="7" fill="#2b2b33"/><circle cx="70" cy="33" r="7" fill="#2b2b33"/>`,
  sports: `<path d="M6 31h88M12 31c0-6 4-8 10-9l16-8h20l14 8c8 1 12 3 12 9" fill="currentColor"/><circle cx="28" cy="33" r="6.5" fill="#2b2b33"/><circle cx="74" cy="33" r="6.5" fill="#2b2b33"/>`,
  limo: `<path d="M4 30h92M8 30c0-8 4-10 10-11l6-6h50l10 6c8 1 12 3 12 11" fill="currentColor"/><circle cx="22" cy="33" r="6.5" fill="#2b2b33"/><circle cx="78" cy="33" r="6.5" fill="#2b2b33"/>`,
  monster: `<path d="M18 24h64M22 24V13c0-2 2-4 4-4h30l12 8v7" fill="currentColor"/><rect x="18" y="24" width="64" height="5" rx="2" fill="currentColor"/><circle cx="30" cy="31" r="12" fill="#2b2b33"/><circle cx="70" cy="31" r="12" fill="#2b2b33"/><circle cx="30" cy="31" r="5" fill="#8a8f9c"/><circle cx="70" cy="31" r="5" fill="#8a8f9c"/>`,
  bus: `<path d="M6 32h88M10 32V10c0-2 2-4 4-4h72c2 0 4 2 4 4v22" fill="currentColor"/><circle cx="26" cy="34" r="7" fill="#2b2b33"/><circle cx="76" cy="34" r="7" fill="#2b2b33"/>`,
}

export class Garage {
  readonly element: HTMLDivElement

  readonly #callbacks: GarageCallbacks
  readonly #cards = new Map<string, HTMLDivElement>()

  #open = false

  constructor(container: HTMLElement, callbacks: GarageCallbacks) {
    this.#callbacks = callbacks

    this.element = document.createElement('div')
    this.element.className = 'garage is-hidden'
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-label', 'Garage')

    const panel = document.createElement('div')
    panel.className = 'garage-panel'
    this.element.appendChild(panel)

    const close = document.createElement('button')
    close.className = 'shop-close'
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.innerHTML = `<svg viewBox="0 0 32 32"><path d="M9 9l14 14M23 9L9 23" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>`
    close.addEventListener('click', () => this.#callbacks.onClose())
    panel.appendChild(close)

    const list = document.createElement('div')
    list.className = 'garage-list'
    panel.appendChild(list)

    for (const def of VEHICLES_BY_PRICE) {
      list.appendChild(this.#buildCard(def))
    }

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
  }

  /** Update ownership, affordability and which car is current. */
  refresh(state: GarageState): void {
    for (const def of VEHICLES_BY_PRICE) {
      const card = this.#cards.get(def.id)
      if (!card) continue

      const owned = state.owned.includes(def.id)
      const active = state.active === def.id
      const affordable = state.coins >= def.price

      card.classList.toggle('is-owned', owned)
      card.classList.toggle('is-active', active)
      card.classList.toggle('is-locked', !owned && !affordable)

      const action = card.querySelector('.garage-action') as HTMLButtonElement
      const label = card.querySelector('.garage-action-label') as HTMLSpanElement
      const coin = card.querySelector('.garage-coin') as SVGElement

      if (active) {
        action.disabled = true
        coin.style.display = 'none'
        label.textContent = '✓'
      } else if (owned) {
        action.disabled = false
        coin.style.display = 'none'
        label.textContent = '▶'
      } else {
        action.disabled = !affordable
        coin.style.display = ''
        label.textContent = String(def.price)
      }
    }
  }

  dispose(): void {
    this.element.remove()
  }

  #buildCard(def: VehicleDef): HTMLDivElement {
    const card = document.createElement('div')
    card.className = 'garage-card'

    const art = document.createElement('div')
    art.className = 'garage-art'
    art.style.color = `#${def.paint.toString(16).padStart(6, '0')}`
    art.innerHTML = `<svg viewBox="0 0 100 44" aria-hidden="true">${SILHOUETTES[def.id] ?? ''}</svg>`
    card.appendChild(art)

    // Seats shown as little person pips rather than a number with a word.
    const seats = document.createElement('div')
    seats.className = 'garage-seats'
    seats.setAttribute('aria-label', `${def.seats} seats`)
    for (let i = 0; i < Math.min(def.seats, 12); i++) {
      const pip = document.createElement('span')
      pip.className = 'garage-seat'
      pip.innerHTML = `<svg viewBox="0 0 12 16"><circle cx="6" cy="4" r="3.2" fill="currentColor"/><path d="M1 16c0-3.2 2.2-5.6 5-5.6s5 2.4 5 5.6z" fill="currentColor"/></svg>`
      seats.appendChild(pip)
    }
    card.appendChild(seats)

    const action = document.createElement('button')
    action.type = 'button'
    action.className = 'garage-action'
    action.setAttribute('aria-label', `Choose or buy ${def.name}`)
    action.innerHTML = `<svg class="garage-coin" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#e0a800"/><circle cx="16" cy="14.8" r="11.5" fill="#ffc93c"/></svg><span class="garage-action-label"></span>`
    action.addEventListener('click', () => {
      // One button does both jobs: buy if unowned, select if owned. A child
      // taps the car they want and the right thing happens.
      const owned = card.classList.contains('is-owned')
      if (owned) this.#callbacks.onSelect(def.id)
      else if (this.#callbacks.onBuy(def.id)) {
        action.classList.remove('is-bought')
        void action.offsetWidth
        action.classList.add('is-bought')
      }
    })
    card.appendChild(action)

    this.#cards.set(def.id, card)
    return card
  }
}
