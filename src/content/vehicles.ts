/**
 * Vehicle definitions — pure data.
 *
 * All balance lives here, not in code: an engineer never edits gameplay
 * systems to tune a top speed, and a future vehicle is a new entry, not a
 * new class. The renderer consumes the `art` block; the physics consumes
 * the `handling` block; the economy consumes `fareMultiplier` and `price`.
 *
 * Speeds are world units/second. The player car is ~48 units long, so
 * 220 u/s reads as a brisk-but-safe 4-5 car lengths per second.
 */

export interface VehicleHandling {
  /** Top speed on road, world units/second. */
  maxSpeed: number
  /** Seconds from standstill to ~2/3 top speed. Lower = punchier. */
  accelTime: number
  /** Steering rate at full lock, radians/second (scaled down at low speed). */
  steerRate: number
  /** Max reverse speed. Kept slow — reverse exists only to get unstuck. */
  reverseSpeed: number
}

export interface VehicleArt {
  /** Body length along travel direction, world units. */
  length: number
  /** Body width, world units. */
  width: number
  /** Corner rounding of the body, 0..1 of half-width. */
  roundness: number
  /** Roof sign (the taxi light). */
  hasSign: boolean
  /** Number of side windows per side (cabin length cue: taxi 1, bus 4). */
  sideWindows: number
  /** Draw a full-length roof stripe. */
  hasStripe: boolean
}

export interface VehicleDef {
  id: string
  /** For code/debugging only — the UI never shows vehicle names as text. */
  name: string
  seats: number
  /** Coins to buy. 0 = owned from the start. */
  price: number
  /** Multiplies every fare earned while driving this vehicle. */
  fareMultiplier: number
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
    handling: {
      maxSpeed: 220,
      accelTime: 1.1,
      steerRate: 3.1,
      reverseSpeed: 70,
    },
    art: {
      length: 48,
      width: 26,
      roundness: 0.9,
      hasSign: true,
      sideWindows: 1,
      hasStripe: false,
    },
  },
  {
    id: 'van',
    name: 'Family Van',
    seats: 7,
    price: 400,
    fareMultiplier: 1.25,
    handling: {
      maxSpeed: 205,
      accelTime: 1.3,
      steerRate: 2.8,
      reverseSpeed: 70,
    },
    art: {
      length: 58,
      width: 28,
      roundness: 0.55,
      hasSign: false,
      sideWindows: 2,
      hasStripe: true,
    },
  },
  {
    id: 'limo',
    name: 'Long Limo',
    seats: 5,
    price: 1200,
    fareMultiplier: 1.8,
    handling: {
      maxSpeed: 235,
      accelTime: 1.2,
      steerRate: 2.4,
      reverseSpeed: 60,
    },
    art: {
      length: 74,
      width: 26,
      roundness: 0.7,
      hasSign: false,
      sideWindows: 3,
      hasStripe: false,
    },
  },
  {
    id: 'bus',
    name: 'Big Bus',
    seats: 12,
    price: 3000,
    fareMultiplier: 2.5,
    handling: {
      maxSpeed: 190,
      accelTime: 1.7,
      steerRate: 2.2,
      reverseSpeed: 55,
    },
    art: {
      length: 88,
      width: 32,
      roundness: 0.4,
      hasSign: false,
      sideWindows: 4,
      hasStripe: true,
    },
  },
]

export function getVehicle(id: string): VehicleDef {
  const def = VEHICLES.find((v) => v.id === id)
  if (!def) {
    // A save referencing an unknown vehicle must not crash the game — fall
    // back to the starter. The save layer validates, this is belt-and-braces.
    return VEHICLES[0]!
  }
  return def
}
