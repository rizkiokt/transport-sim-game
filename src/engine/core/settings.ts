/**
 * Player and accessibility settings, plus the automatic quality tier.
 *
 * Two distinct concerns share this module because they feed the same
 * consumers:
 *
 * 1. **Accessibility.** A game for young children has to be gentle by
 *    default. Screen shake, flashing, and dense particles are genuinely
 *    unpleasant for some players and can trigger motion sickness or, in rare
 *    cases, photosensitive reactions. Effects read `shakeScale`,
 *    `particleScale`, and `flashAllowed` from here rather than checking the
 *    media query themselves, so there is exactly one place to get it right.
 *
 * 2. **Quality tiers.** The same game must hold 60fps on a cheap tablet and
 *    look its best on a desktop. Rather than ask the player to pick (a
 *    6-year-old will not), we watch the frame rate and step quality down
 *    automatically.
 *
 * Downgrades are sticky within a session and hysteretic: we drop quality
 * readily but restore it only after a long stretch of comfortable frames, so
 * the game never oscillates visibly between tiers.
 */

import { EventBus } from './events.js'

export type QualityTier = 'low' | 'medium' | 'high'

export interface Settings {
  /** Master mute. Kids play in public; this must be one tap away. */
  muted: boolean
  /** 0..1 */
  masterVolume: number
  musicEnabled: boolean

  /**
   * Reduces or removes camera shake, screen flashes, and heavy particle
   * bursts. Defaults from `prefers-reduced-motion`.
   */
  reducedMotion: boolean

  /**
   * Adds redundant shape/icon cues wherever colour alone would carry meaning
   * (destination markers, upgrade tracks).
   */
  highContrastMarkers: boolean

  /** 'auto' lets the frame-rate watchdog choose. */
  qualityPreference: QualityTier | 'auto'

  /** Slows the vehicle's top speed for players who find it too fast. */
  gentleSpeed: boolean
}

export interface SettingsEvents extends Record<string, unknown> {
  changed: { settings: Readonly<Settings> }
  qualityChanged: { tier: QualityTier; reason: 'auto' | 'manual' }
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  masterVolume: 0.8,
  musicEnabled: true,
  reducedMotion: false,
  highContrastMarkers: false,
  qualityPreference: 'auto',
  gentleSpeed: false,
}

/** Multipliers each tier applies to the effects that consume them. */
interface TierProfile {
  particleScale: number
  /** Cap on device pixel ratio. */
  maxDpr: number
  /** Draw cloud shadows, ambient pedestrians, and other background life. */
  ambientDetail: boolean
  /** Number of ambient traffic vehicles. */
  trafficBudget: number
  /** Draw the soft ground shadow under every entity. */
  softShadows: boolean
}

const TIER_PROFILES: Record<QualityTier, TierProfile> = {
  low: {
    particleScale: 0.35,
    maxDpr: 1,
    ambientDetail: false,
    trafficBudget: 6,
    softShadows: false,
  },
  medium: {
    particleScale: 0.7,
    maxDpr: 1.5,
    ambientDetail: true,
    trafficBudget: 14,
    softShadows: true,
  },
  high: {
    particleScale: 1,
    maxDpr: 2,
    ambientDetail: true,
    trafficBudget: 24,
    softShadows: true,
  },
}

export class SettingsManager {
  readonly events = new EventBus<SettingsEvents>()

  #settings: Settings
  #tier: QualityTier = 'high'

  /** Seconds spent below the acceptable frame rate since the last tier change. */
  #slowTime = 0
  /** Seconds spent comfortably above it. */
  #fastTime = 0
  /** Suppresses the watchdog briefly after a change so it can settle. */
  #cooldown = 0

  #reducedMotionQuery: MediaQueryList | null = null

  constructor(initial?: Partial<Settings>) {
    this.#settings = { ...DEFAULT_SETTINGS, ...initial }

    // Honour the OS preference unless the player has explicitly overridden it.
    if (initial?.reducedMotion === undefined && typeof window !== 'undefined' && window.matchMedia) {
      this.#reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.#settings.reducedMotion = this.#reducedMotionQuery.matches
      this.#reducedMotionQuery.addEventListener('change', this.#onReducedMotionChange)
    }

    if (this.#settings.qualityPreference !== 'auto') {
      this.#tier = this.#settings.qualityPreference
    } else {
      this.#tier = guessInitialTier()
    }
  }

  get settings(): Readonly<Settings> {
    return this.#settings
  }

  get tier(): QualityTier {
    return this.#tier
  }

  get profile(): Readonly<TierProfile> {
    return TIER_PROFILES[this.#tier]
  }

  // --------------------------------------------------------- derived values

  /**
   * Multiplier for camera shake magnitude. Zero under reduced motion — shake
   * is the single most motion-sickness-inducing effect in a driving game.
   */
  get shakeScale(): number {
    return this.#settings.reducedMotion ? 0 : 1
  }

  /** Multiplier for particle emission counts. */
  get particleScale(): number {
    const tierScale = TIER_PROFILES[this.#tier].particleScale
    return this.#settings.reducedMotion ? tierScale * 0.4 : tierScale
  }

  /** Whether full-screen flashes and strobing highlights are permitted. */
  get flashAllowed(): boolean {
    return !this.#settings.reducedMotion
  }

  /** Cap on how far a vehicle body may visually roll into a turn, radians. */
  get rotationCap(): number {
    return this.#settings.reducedMotion ? 0.05 : 0.22
  }

  /** Multiplier on UI animation durations; larger means slower and calmer. */
  get uiAnimationScale(): number {
    return this.#settings.reducedMotion ? 0.5 : 1
  }

  get maxDpr(): number {
    return TIER_PROFILES[this.#tier].maxDpr
  }

  get trafficBudget(): number {
    return TIER_PROFILES[this.#tier].trafficBudget
  }

  get softShadows(): boolean {
    return TIER_PROFILES[this.#tier].softShadows
  }

  get ambientDetail(): boolean {
    return TIER_PROFILES[this.#tier].ambientDetail
  }

  // -------------------------------------------------------------- mutation

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.#settings[key] === value) return
    this.#settings = { ...this.#settings, [key]: value }

    if (key === 'qualityPreference') {
      const preference = value as Settings['qualityPreference']
      if (preference !== 'auto') this.#setTier(preference, 'manual')
      // Switching back to auto lets the watchdog take over from here.
      this.#resetWatchdog()
    }

    this.events.emit('changed', { settings: this.#settings })
  }

  update(patch: Partial<Settings>): void {
    for (const [key, value] of Object.entries(patch)) {
      this.set(key as keyof Settings, value as never)
    }
  }

  toggleMute(): boolean {
    this.set('muted', !this.#settings.muted)
    return this.#settings.muted
  }

  // -------------------------------------------------------------- watchdog

  /**
   * Feed the frame-rate watchdog. Call once per frame with the smoothed fps.
   *
   * Thresholds are deliberately asymmetric: we drop after 2.5s below 45fps,
   * but only restore after 12s above 58fps. Downgrading is cheap and mostly
   * invisible; upgrading into a stutter is not.
   */
  observeFrameRate(fps: number, dt: number): void {
    if (this.#settings.qualityPreference !== 'auto') return

    if (this.#cooldown > 0) {
      this.#cooldown -= dt
      return
    }

    // Ignore the startup transient and any nonsense values.
    if (!Number.isFinite(fps) || fps <= 0) return

    if (fps < 45) {
      this.#slowTime += dt
      this.#fastTime = 0
    } else if (fps > 58) {
      this.#fastTime += dt
      this.#slowTime = 0
    } else {
      // In the dead band, decay both so brief excursions don't accumulate.
      this.#slowTime = Math.max(0, this.#slowTime - dt * 0.5)
      this.#fastTime = Math.max(0, this.#fastTime - dt * 0.5)
    }

    if (this.#slowTime > 2.5 && this.#tier !== 'low') {
      this.#setTier(this.#tier === 'high' ? 'medium' : 'low', 'auto')
      return
    }

    if (this.#fastTime > 12 && this.#tier !== 'high') {
      this.#setTier(this.#tier === 'low' ? 'medium' : 'high', 'auto')
    }
  }

  dispose(): void {
    this.#reducedMotionQuery?.removeEventListener('change', this.#onReducedMotionChange)
    this.#reducedMotionQuery = null
    this.events.clear()
  }

  #setTier(tier: QualityTier, reason: 'auto' | 'manual'): void {
    if (this.#tier === tier) return
    this.#tier = tier
    this.#resetWatchdog()
    this.events.emit('qualityChanged', { tier, reason })
  }

  #resetWatchdog(): void {
    this.#slowTime = 0
    this.#fastTime = 0
    this.#cooldown = 3
  }

  readonly #onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.#settings = { ...this.#settings, reducedMotion: event.matches }
    this.events.emit('changed', { settings: this.#settings })
  }
}

/**
 * A first guess at the quality tier, before any frames have been measured.
 *
 * Device detection is unreliable, so this only avoids the worst first
 * impression — the watchdog corrects it within seconds either way.
 */
function guessInitialTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'medium'

  const cores = navigator.hardwareConcurrency ?? 4
  // Not in every browser's typings, but widely supported and a good signal.
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4

  if (cores <= 2 || memory <= 2) return 'low'
  if (cores <= 4 || memory <= 4) return 'medium'
  return 'high'
}
