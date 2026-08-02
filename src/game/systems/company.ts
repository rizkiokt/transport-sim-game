/**
 * The company: drivers you hire to work the cars you are not driving.
 *
 * This is what turns "a taxi game" into "a transport company". Until now
 * every car you bought sat idle the moment you swapped away from it, so a
 * second vehicle was worth less than the coins it cost. Hiring a driver for
 * it means the fleet earns whether or not you are behind the wheel — and the
 * choice of which car to drive yourself becomes interesting, because the one
 * you take is the one that stops earning on its own.
 *
 * The design rules that matter for a six-year-old:
 *
 * - **You never lose money.** There are no wages, no upkeep, no way for a
 *   decision to go backwards. A driver is a one-off cost and then pure gain.
 * - **Income is visible.** Each driver completes a trip on a timer and the
 *   coins land with the same sound and animation as a fare you drove
 *   yourself, so it is obvious where the money came from.
 * - **Driving still wins.** A driver earns meaningfully less per minute than
 *   a child playing well, so hiring is a reward for progress rather than a
 *   reason to put the tablet down and wait.
 *
 * Bigger vehicles carry more people, so their drivers take longer per trip
 * but bring back more — the same trade the player feels when they drive a bus
 * instead of the taxi.
 */

import { getVehicle, type VehicleDef } from '../../content/vehicles.js'

export interface Driver {
  /** The vehicle this driver is assigned to. One driver per vehicle. */
  vehicleId: string
  name: string
  /** 0..1 progress through the current trip. */
  progress: number
}

/** What a driver in a given vehicle is worth. */
export interface DriverEconomics {
  /** Seconds per completed trip. */
  tripSeconds: number
  /** Coins paid per completed trip. */
  fare: number
  /** Coins per minute, for display. */
  perMinute: number
}

/**
 * Names, so a driver is a person rather than a slot.
 *
 * Short and phonetically simple: these are the only proper nouns a
 * pre-reader meets in the game, and they are chosen to be guessable from
 * their first letter alongside the portrait colour.
 */
const NAMES = [
  'Ana', 'Ben', 'Coco', 'Dev', 'Ella', 'Finn', 'Gus', 'Hana',
  'Ivo', 'Jo', 'Kit', 'Lulu', 'Milo', 'Nina', 'Otto', 'Pip',
]

/** Base cost to hire, scaled by how capable the vehicle is. */
export function hireCost(def: VehicleDef): number {
  // Roughly a third of the vehicle's own price, floored so the first hire is
  // always reachable soon after buying a second car.
  return Math.max(40, Math.round((def.price * 0.35) / 5) * 5)
}

export function driverEconomics(def: VehicleDef): DriverEconomics {
  // Seats drive both halves of the trade: more seats means a longer round
  // trip but a bigger payout at the end of it.
  const tripSeconds = 26 + def.seats * 3.5
  const fare = Math.round(def.seats * 5 * def.fareMultiplier)
  return { tripSeconds, fare, perMinute: Math.round((fare / tripSeconds) * 60) }
}

export interface CompanyEvents {
  /** A driver finished a trip and banked a fare. */
  onEarn(driver: Driver, coins: number): void
}

export class CompanySystem {
  readonly #drivers: Driver[] = []
  readonly #events: CompanyEvents

  constructor(events: CompanyEvents, saved: readonly Driver[] = []) {
    this.#events = events
    for (const d of saved) this.#drivers.push({ ...d })
  }

  get drivers(): readonly Driver[] {
    return this.#drivers
  }

  hasDriver(vehicleId: string): boolean {
    return this.#drivers.some((d) => d.vehicleId === vehicleId)
  }

  driverFor(vehicleId: string): Driver | undefined {
    return this.#drivers.find((d) => d.vehicleId === vehicleId)
  }

  /**
   * Hire a driver for a vehicle.
   *
   * Returns the new driver, or null if that vehicle already has one — the
   * caller is responsible for having taken the coins.
   */
  hire(vehicleId: string): Driver | null {
    if (this.hasDriver(vehicleId)) return null
    const driver: Driver = {
      vehicleId,
      name: NAMES[this.#drivers.length % NAMES.length]!,
      progress: 0,
    }
    this.#drivers.push(driver)
    return driver
  }

  /**
   * Advance every driver's trip.
   *
   * @param activeVehicleId the car the player is driving. Its driver, if any,
   *   is idle — you cannot be out in a car and have someone else earning in
   *   it at the same time. This is the rule that makes choosing what to drive
   *   a real decision rather than a cosmetic one.
   */
  update(dt: number, activeVehicleId: string): void {
    for (const driver of this.#drivers) {
      if (driver.vehicleId === activeVehicleId) continue

      const def = getVehicle(driver.vehicleId)
      const economics = driverEconomics(def)
      driver.progress += dt / economics.tripSeconds

      // A loop, not an if: a long pause (a backgrounded tab, a big dt) should
      // pay out every trip it covers rather than silently dropping all but
      // one of them.
      while (driver.progress >= 1) {
        driver.progress -= 1
        this.#events.onEarn(driver, economics.fare)
      }
    }
  }

  /** Total coins per minute the fleet earns, excluding the car being driven. */
  incomePerMinute(activeVehicleId: string): number {
    let total = 0
    for (const driver of this.#drivers) {
      if (driver.vehicleId === activeVehicleId) continue
      total += driverEconomics(getVehicle(driver.vehicleId)).perMinute
    }
    return total
  }

  /** Serialisable state for the save file. */
  toJSON(): Driver[] {
    return this.#drivers.map((d) => ({ ...d }))
  }

  /**
   * Replace the whole roster.
   *
   * Used when a save is imported: the system outlives the save it was built
   * from, so it needs a way to adopt a different one wholesale rather than
   * merging into what it already had.
   */
  load(drivers: readonly Driver[]): void {
    this.#drivers.length = 0
    for (const d of drivers) this.#drivers.push({ ...d })
  }

  /**
   * Drop drivers assigned to vehicles that are no longer owned.
   *
   * Runs after a save is imported, where the two lists can disagree.
   */
  prune(ownedVehicles: readonly string[]): void {
    for (let i = this.#drivers.length - 1; i >= 0; i--) {
      if (!ownedVehicles.includes(this.#drivers[i]!.vehicleId)) this.#drivers.splice(i, 1)
    }
  }
}
