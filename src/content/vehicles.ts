/**
 * Vehicle definitions — pure data.
 *
 * All balance and all proportions live here. Adding a vehicle is a new entry
 * in this list; no rendering or gameplay code changes. That is the whole
 * reason the car model is parameterised rather than hand-built.
 *
 * Prices are tuned against a fare of roughly 20-40 coins per ride: the second
 * vehicle is a handful of rides away, and the most expensive is a genuine
 * goal without being a wall. Nothing here is ever a downgrade — a bigger
 * vehicle earns more per ride, so buying is always progress.
 */

export interface VehicleHandling {
  /** Top speed on road, world units/second (before the 1/12 world scale). */
  maxSpeed: number
  /** Seconds from standstill to ~2/3 top speed. Lower = punchier. */
  accelTime: number
  /** Steering rate at full lock, radians/second. */
  steerRate: number
  /** Max reverse speed. Slow by design — reverse exists to get unstuck. */
  reverseSpeed: number
}

export interface VehicleArt {
  /** Body length along travel, in the original top-down units. */
  length: number
  /** Body width. */
  width: number
  /** Corner rounding, 0..1. */
  roundness: number
  /** A roof sign, like a taxi light. */
  hasSign: boolean
  /** Side windows per side — the main cue that separates a bus from a car. */
  sideWindows: number
  /** A full-length trim stripe. */
  hasStripe: boolean

  /** Wheel radius multiplier. 1 is a normal car; a monster truck is ~2. */
  wheelScale?: number
  /** Ride-height multiplier. */
  clearanceScale?: number
  /** Body-height multiplier. */
  bodyHeightScale?: number
  /**
   * Windscreen rake, 0..1. 0 is an upright van screen, 1 is a heavily raked
   * sports-car screen. This is the single strongest cue for what kind of
   * vehicle something is.
   */
  cabinSlope?: number
  /** Knobbly tyres, a roof light bar, and exposed suspension. */
  offRoad?: boolean
  /** A rear cargo bed instead of a boot. */
  pickupBed?: boolean
}

export interface VehicleDef {
  id: string
  /** For code and debugging. The UI shows a silhouette and a price. */
  name: string
  seats: number
  /** Coins to buy. 0 means owned from the start. */
  price: number
  /** Multiplies every fare earned while driving this vehicle. */
  fareMultiplier: number
  /** Body paint, 0xRRGGBB. */
  paint: number
  handling: VehicleHandling
  art: VehicleArt
}

export const VEHICLES: readonly VehicleDef[] = [
  {
    id: 'taxi',
    name: 'Little Taxi',
    seats: 3,
    price: 0,
    fareMultiplier: 1,
    paint: 0xffc93c,
    handling: { maxSpeed: 220, accelTime: 1.1, steerRate: 3.1, reverseSpeed: 70 },
    art: {
      length: 48,
      width: 26,
      roundness: 0.9,
      hasSign: true,
      sideWindows: 1,
      hasStripe: false,
      cabinSlope: 0.45,
    },
  },
  {
    id: 'van',
    name: 'Family Van',
    seats: 7,
    price: 200,
    fareMultiplier: 1.25,
    paint: 0x4cc9f0,
    handling: { maxSpeed: 205, accelTime: 1.3, steerRate: 2.8, reverseSpeed: 70 },
    art: {
      length: 58,
      width: 28,
      roundness: 0.55,
      hasSign: false,
      sideWindows: 2,
      hasStripe: true,
      bodyHeightScale: 1.2,
      // Vans have famously upright screens.
      cabinSlope: 0.12,
    },
  },
  {
    id: 'sports',
    name: 'Speedy',
    seats: 2,
    price: 450,
    fareMultiplier: 1.5,
    paint: 0xe84a4a,
    handling: { maxSpeed: 275, accelTime: 0.8, steerRate: 3.4, reverseSpeed: 60 },
    art: {
      length: 50,
      width: 27,
      roundness: 0.75,
      hasSign: false,
      sideWindows: 1,
      hasStripe: true,
      wheelScale: 1.05,
      clearanceScale: 0.62,
      bodyHeightScale: 0.72,
      cabinSlope: 1,
    },
  },
  {
    id: 'limo',
    name: 'Long Limo',
    seats: 5,
    price: 700,
    fareMultiplier: 1.9,
    paint: 0x2f3540,
    handling: { maxSpeed: 235, accelTime: 1.2, steerRate: 2.4, reverseSpeed: 60 },
    art: {
      length: 82,
      width: 26,
      roundness: 0.7,
      hasSign: false,
      sideWindows: 3,
      hasStripe: false,
      bodyHeightScale: 0.9,
      cabinSlope: 0.5,
    },
  },
  {
    id: 'monster',
    name: 'Monster Truck',
    seats: 4,
    price: 1000,
    fareMultiplier: 2.1,
    paint: 0x43c465,
    handling: {
      // Heavy and slow to turn, but it climbs kerbs without noticing and is
      // by far the most fun thing to own.
      maxSpeed: 210,
      accelTime: 1.6,
      steerRate: 2.3,
      reverseSpeed: 80,
    },
    art: {
      length: 56,
      width: 34,
      roundness: 0.35,
      hasSign: false,
      sideWindows: 1,
      hasStripe: true,
      wheelScale: 2.1,
      clearanceScale: 2.6,
      bodyHeightScale: 1.05,
      cabinSlope: 0.2,
      offRoad: true,
      pickupBed: true,
    },
  },
  {
    id: 'bus',
    name: 'Big Bus',
    seats: 12,
    price: 1500,
    fareMultiplier: 2.6,
    paint: 0xff8c42,
    handling: { maxSpeed: 190, accelTime: 1.7, steerRate: 2.2, reverseSpeed: 55 },
    art: {
      length: 96,
      width: 32,
      roundness: 0.3,
      hasSign: false,
      sideWindows: 4,
      hasStripe: true,
      bodyHeightScale: 1.55,
      cabinSlope: 0.05,
    },
  },
]

export function getVehicle(id: string): VehicleDef {
  // A save naming an unknown vehicle must not crash the game — fall back to
  // the starter. The save layer validates too; this is belt and braces.
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0]!
}

/** Vehicles in the order they should appear in the garage: cheapest first. */
export const VEHICLES_BY_PRICE: readonly VehicleDef[] = [...VEHICLES].sort(
  (a, b) => a.price - b.price,
)
