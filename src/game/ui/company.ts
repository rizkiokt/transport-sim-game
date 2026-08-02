/**
 * The company board: your fleet, and who is driving what.
 *
 * One row per vehicle you own. A vehicle with a driver shows their initial,
 * a progress ring filling toward their next fare, and what they earn a
 * minute. A vehicle without one shows a hire price.
 *
 * The same text-light rules as the rest of the game: the only words are short
 * driver names, and every other piece of information is a number, a shape or
 * a colour. The progress ring in particular is doing real work — it is how a
 * pre-reader learns that time passing is what makes the coins arrive.
 *
 * The car you are personally driving is marked and its driver shown as idle,
 * because that is the rule that makes the whole system a decision: whichever
 * car you take out is the one that stops earning by itself.
 */

import { VEHICLES_BY_PRICE, getVehicle } from '../../content/vehicles.js'
import { driverEconomics, hireCost, type Driver } from '../systems/company.js'

export interface CompanyCallbacks {
  /** Returns true when the hire succeeded (the caller takes the coins). */
  onHire(vehicleId: string): boolean
  onClose(): void
}

export interface CompanyState {
  coins: number
  owned: readonly string[]
  /** The vehicle the player is driving right now. */
  active: string
  drivers: readonly Driver[]
}

/** Circumference of the progress ring, for the stroke-dash trick. */
const RING_CIRCUMFERENCE = 2 * Math.PI * 15

export class CompanyBoard {
  readonly element: HTMLDivElement

  readonly #callbacks: CompanyCallbacks
  readonly #rows = new Map<string, HTMLDivElement>()
  readonly #list: HTMLDivElement
  readonly #total: HTMLSpanElement

  #open = false

  constructor(container: HTMLElement, callbacks: CompanyCallbacks) {
    this.#callbacks = callbacks

    this.element = document.createElement('div')
    this.element.className = 'company is-hidden'
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-label', 'Your company')

    const panel = document.createElement('div')
    panel.className = 'company-panel'
    this.element.appendChild(panel)

    const close = document.createElement('button')
    close.className = 'shop-close'
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.innerHTML = `<svg viewBox="0 0 32 32"><path d="M9 9l14 14M23 9L9 23" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>`
    close.addEventListener('click', () => this.#callbacks.onClose())
    panel.appendChild(close)

    // Headline: what the whole fleet earns per minute. The one number a
    // parent or child will actually watch.
    const header = document.createElement('div')
    header.className = 'company-header'
    header.innerHTML = `
      <svg class="company-header-icon" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="#ffc93c"/>
        <circle cx="16" cy="16" r="9.5" fill="#f0b400"/>
      </svg>
      <span class="company-total">0</span>
      <span class="company-total-unit">/min</span>`
    panel.appendChild(header)
    this.#total = header.querySelector('.company-total') as HTMLSpanElement

    this.#list = document.createElement('div')
    this.#list.className = 'company-list'
    panel.appendChild(this.#list)

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

  /**
   * Rebuild the board.
   *
   * Rows are created once per vehicle and then updated in place, so the ring
   * animates smoothly rather than restarting every refresh.
   */
  refresh(state: CompanyState): void {
    let perMinute = 0

    for (const def of VEHICLES_BY_PRICE) {
      const owned = state.owned.includes(def.id)
      let row = this.#rows.get(def.id)

      if (!owned) {
        // Vehicles you do not own have no place here — the garage is where
        // you buy cars; this board is only about staffing the ones you have.
        if (row) {
          row.remove()
          this.#rows.delete(def.id)
        }
        continue
      }

      if (!row) {
        row = this.#buildRow(def.id)
        this.#rows.set(def.id, row)
        this.#list.appendChild(row)
      }

      const driver = state.drivers.find((d) => d.vehicleId === def.id)
      const isActive = state.active === def.id
      const economics = driverEconomics(def)
      const cost = hireCost(def)

      row.classList.toggle('is-active', isActive)
      row.classList.toggle('is-staffed', driver !== undefined)

      const name = row.querySelector('.company-name') as HTMLSpanElement
      const rate = row.querySelector('.company-rate') as HTMLSpanElement
      const ring = row.querySelector('.company-ring-fill') as SVGCircleElement
      const initial = row.querySelector('.company-initial') as HTMLSpanElement
      const action = row.querySelector('.company-action') as HTMLButtonElement

      if (driver) {
        name.textContent = driver.name
        initial.textContent = driver.name.slice(0, 1)
        action.hidden = true

        if (isActive) {
          // You are driving this one, so nobody is earning in it.
          rate.textContent = '—'
          ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE)
        } else {
          rate.textContent = `+${economics.perMinute}`
          ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - driver.progress))
          perMinute += economics.perMinute
        }
      } else {
        name.textContent = ''
        initial.textContent = '+'
        rate.textContent = ''
        ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE)
        action.hidden = false
        action.disabled = state.coins < cost
        const price = action.querySelector('.company-price') as HTMLSpanElement
        price.textContent = String(cost)
      }
    }

    this.#total.textContent = String(perMinute)
  }

  dispose(): void {
    this.element.remove()
    this.#rows.clear()
  }

  // -------------------------------------------------------------- internals

  #buildRow(vehicleId: string): HTMLDivElement {
    const def = getVehicle(vehicleId)
    const row = document.createElement('div')
    row.className = 'company-row'

    row.innerHTML = `
      <div class="company-portrait">
        <svg class="company-ring" viewBox="0 0 34 34" aria-hidden="true">
          <circle cx="17" cy="17" r="15" class="company-ring-track"/>
          <circle cx="17" cy="17" r="15" class="company-ring-fill"
                  stroke-dasharray="${RING_CIRCUMFERENCE}"
                  stroke-dashoffset="${RING_CIRCUMFERENCE}"/>
        </svg>
        <span class="company-initial">+</span>
      </div>
      <div class="company-info">
        <span class="company-seats">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="5" r="3" fill="currentColor"/>
            <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6z" fill="currentColor"/>
          </svg>${def.seats}
        </span>
        <span class="company-name"></span>
      </div>
      <span class="company-rate"></span>
      <button class="company-action" type="button">
        <svg class="shop-coin" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="#ffc93c"/>
          <circle cx="16" cy="16" r="9" fill="#f0b400"/>
        </svg><span class="company-price"></span>
      </button>`

    // A driver-coloured dot so each row is identifiable by colour as well as
    // by the vehicle silhouette a child already knows from the garage.
    const portrait = row.querySelector('.company-portrait') as HTMLDivElement
    portrait.style.setProperty('--paint', `#${def.paint.toString(16).padStart(6, '0')}`)

    const action = row.querySelector('.company-action') as HTMLButtonElement
    action.addEventListener('click', () => {
      if (this.#callbacks.onHire(vehicleId)) {
        action.classList.remove('is-hired')
        // Restart the pop animation on the next frame.
        void action.offsetWidth
        action.classList.add('is-hired')
      }
    })

    return row
  }
}
