/**
 * Company economics.
 *
 * These are balance tests, not correctness tests: they encode design rules
 * that are easy to break by tuning one number, and that nobody would notice
 * were broken until a child stopped playing.
 */

import { describe, expect, it } from 'vitest'

import { VEHICLES, getVehicle } from '../../content/vehicles.js'
import {
  ACTIVE_DRIVING_PER_MINUTE,
  CompanySystem,
  driverEconomics,
  hireCost,
} from './company.js'

describe('driver economics', () => {
  it('never lets a hired driver out-earn the child driving', () => {
    // The rule that keeps the game a driving game. Break it and the optimal
    // strategy becomes putting the tablet down, which is the opposite of the
    // point.
    for (const def of VEHICLES) {
      expect(driverEconomics(def).perMinute).toBeLessThan(ACTIVE_DRIVING_PER_MINUTE)
    }
  })

  it('pays back a hire within a few minutes of play', () => {
    // A price a six-year-old saves up for and then waits twenty minutes to
    // recoup teaches the wrong lesson about what the button did.
    for (const def of VEHICLES) {
      const minutes = hireCost(def) / driverEconomics(def).perMinute
      expect(minutes).toBeGreaterThan(1)
      expect(minutes).toBeLessThan(12)
    }
  })

  it('makes bigger vehicles worth more per trip but slower to complete one', () => {
    const taxi = driverEconomics(getVehicle('taxi'))
    const bus = driverEconomics(getVehicle('bus'))
    expect(bus.fare).toBeGreaterThan(taxi.fare)
    expect(bus.tripSeconds).toBeGreaterThan(taxi.tripSeconds)
    expect(bus.perMinute).toBeGreaterThan(taxi.perMinute)
  })
})

describe('CompanySystem', () => {
  function make(): { company: CompanySystem; earned: number[] } {
    const earned: number[] = []
    const company = new CompanySystem({ onEarn: (_d, coins) => earned.push(coins) })
    return { company, earned }
  }

  it('pays a driver once per completed trip', () => {
    const { company, earned } = make()
    company.hire('van')
    const trip = driverEconomics(getVehicle('van')).tripSeconds

    company.update(trip * 0.9, 'taxi')
    expect(earned).toHaveLength(0)
    company.update(trip * 0.2, 'taxi')
    expect(earned).toHaveLength(1)
  })

  it('pays every trip covered by a large time step, not just one', () => {
    // A backgrounded tab can hand back a very large dt. Dropping all but one
    // trip would quietly rob the player of the time they were away.
    const { company, earned } = make()
    company.hire('van')
    const trip = driverEconomics(getVehicle('van')).tripSeconds

    company.update(trip * 5.5, 'taxi')
    expect(earned).toHaveLength(5)
  })

  it('idles the driver of the car the player is driving', () => {
    const { company, earned } = make()
    company.hire('van')
    company.update(10_000, 'van')
    expect(earned).toHaveLength(0)
    expect(company.incomePerMinute('van')).toBe(0)
  })

  it('refuses a second driver for the same vehicle', () => {
    const { company } = make()
    expect(company.hire('van')).not.toBeNull()
    expect(company.hire('van')).toBeNull()
    expect(company.drivers).toHaveLength(1)
  })

  it('drops drivers for vehicles an imported save does not own', () => {
    const { company } = make()
    company.hire('van')
    company.hire('bus')
    company.prune(['taxi', 'bus'])
    expect(company.drivers.map((d) => d.vehicleId)).toEqual(['bus'])
  })

  it('adopts an imported roster wholesale rather than merging', () => {
    const { company } = make()
    company.hire('van')
    company.load([{ vehicleId: 'bus', name: 'Zed', progress: 0.5 }])
    expect(company.drivers).toHaveLength(1)
    expect(company.drivers[0]?.vehicleId).toBe('bus')
  })
})
