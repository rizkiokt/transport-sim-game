/**
 * Upgrades — pure data.
 *
 * Deliberately cheap. A single ride pays about 20 coins, so the first upgrade
 * of every track is affordable after one or two deliveries. For a 6-year-old
 * the reward loop has to close inside one sitting: an upgrade you save six
 * sessions for is not a goal, it is a wall.
 *
 * Four tracks, five levels each, and every one of them makes the car
 * *better* — there are no trade-offs and no wrong purchases. A child cannot
 * ruin their car, so nothing here needs undoing, refunding or explaining.
 */

export type UpgradeId = 'speed' | 'boost' | 'grip' | 'fare'

export interface UpgradeDef {
  id: UpgradeId
  /** For code and debugging only. The UI shows an icon and a number. */
  name: string
  maxLevel: number
  /** Cost of the first level. */
  baseCost: number
  /** Each level costs this much more than the last. */
  costGrowth: number
  /** Fractional improvement per level, applied multiplicatively. */
  perLevel: number
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'speed',
    name: 'Top speed',
    maxLevel: 5,
    baseCost: 20,
    costGrowth: 1.55,
    perLevel: 0.1,
  },
  {
    id: 'boost',
    name: 'Acceleration',
    maxLevel: 5,
    baseCost: 15,
    costGrowth: 1.5,
    perLevel: 0.12,
  },
  {
    id: 'grip',
    name: 'Steering',
    maxLevel: 5,
    baseCost: 15,
    costGrowth: 1.5,
    perLevel: 0.1,
  },
  {
    id: 'fare',
    name: 'Fare bonus',
    maxLevel: 5,
    baseCost: 25,
    costGrowth: 1.7,
    perLevel: 0.15,
  },
]

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id)
}

/**
 * Cost to go from `level` to `level + 1`, or null when already maxed.
 *
 * Rounded to the nearest 5 so every price a child sees is a round number they
 * can compare against their coin counter at a glance.
 */
export function upgradeCost(def: UpgradeDef, level: number): number | null {
  if (level >= def.maxLevel) return null
  const raw = def.baseCost * Math.pow(def.costGrowth, level)
  return Math.max(5, Math.round(raw / 5) * 5)
}

/** Total multiplier for a track at a given level. Level 0 is always 1. */
export function upgradeMultiplier(def: UpgradeDef, level: number): number {
  return 1 + def.perLevel * Math.max(0, Math.min(level, def.maxLevel))
}

/** Every multiplier at once, for feeding into vehicle handling and fares. */
export interface UpgradeEffects {
  /** Multiplies top speed. */
  speed: number
  /** Divides the time to reach speed, so higher is punchier. */
  boost: number
  /** Multiplies steering rate. */
  grip: number
  /** Multiplies every fare earned. */
  fare: number
}

export function computeEffects(levels: Readonly<Record<string, number>>): UpgradeEffects {
  const effect = (id: UpgradeId): number => {
    const def = getUpgrade(id)
    if (!def) return 1
    return upgradeMultiplier(def, levels[id] ?? 0)
  }

  return {
    speed: effect('speed'),
    boost: effect('boost'),
    grip: effect('grip'),
    fare: effect('fare'),
  }
}

export const NEUTRAL_EFFECTS: UpgradeEffects = { speed: 1, boost: 1, grip: 1, fare: 1 }
