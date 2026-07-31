/**
 * The WebAudio backbone.
 *
 * There are no audio files in this project — every sound is synthesised at
 * runtime from oscillators and noise. That keeps the deployed bundle tiny and
 * sidesteps asset hosting entirely, and it means sounds can react continuously
 * to gameplay (engine pitch tracking speed, for instance) instead of being
 * fixed clips.
 *
 * This module owns the graph and the safety rails; individual sound recipes
 * live in `sfx.ts` and `music.ts`.
 *
 * Three things matter for a children's game specifically:
 * 1. **Never clip.** A limiter sits on the master bus. Distortion through a
 *    tablet speaker at close range is genuinely unpleasant.
 * 2. **Never pile up.** Kids mash buttons. Voices are capped and stolen, and
 *    identical sounds retriggered within a few milliseconds are dropped.
 * 3. **Start muted-until-touched.** Browsers require a user gesture before
 *    audio can play; we resume the context on the first interaction.
 */

export type BusName = 'sfx' | 'music' | 'ui' | 'ambient'

export interface AudioBusOptions {
  /** Max simultaneous scheduled voices before stealing kicks in. */
  maxVoices?: number
  /** Master gain, 0..1. */
  masterVolume?: number
}

interface BusNode {
  gain: GainNode
  /** User-facing volume for this bus, 0..1. */
  volume: number
}

/** A scheduled voice we track for stealing and cleanup. */
interface Voice {
  /** Nodes to stop when the voice is killed early. */
  sources: Array<AudioScheduledSourceNode>
  gain: GainNode
  /** Context time this voice is expected to end. */
  endTime: number
  bus: BusName
  /** Priority; lower values are stolen first. */
  priority: number
}

export class AudioBus {
  #ctx: AudioContext | null = null

  #master: GainNode | null = null
  readonly #buses = new Map<BusName, BusNode>()

  #masterVolume: number
  #muted = false
  readonly #maxVoices: number

  #voices: Voice[] = []

  /** Shared noise buffer, generated once — used by tyres, wind, and percussion. */
  #noiseBuffer: AudioBuffer | null = null

  /** Last play time per sound key, for retrigger throttling. */
  readonly #lastPlayed = new Map<string, number>()

  #unlocked = false
  #unlockHandlersAttached = false

  constructor(options: AudioBusOptions = {}) {
    this.#maxVoices = options.maxVoices ?? 24
    this.#masterVolume = options.masterVolume ?? 0.8
  }

  /** Null until {@link init} has run and the context exists. */
  get context(): AudioContext | null {
    return this.#ctx
  }

  get isReady(): boolean {
    return this.#ctx !== null && this.#ctx.state === 'running'
  }

  get muted(): boolean {
    return this.#muted
  }

  /** Current context time, or 0 before init. Sound recipes schedule against this. */
  get now(): number {
    return this.#ctx?.currentTime ?? 0
  }

  /**
   * Create the audio graph. Safe to call before any user gesture — the context
   * will simply start suspended and be resumed by {@link attachUnlockHandlers}.
   */
  init(): void {
    if (this.#ctx) return

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!Ctor) {
      // No WebAudio — the game stays fully playable, just silent.
      return
    }

    const ctx = new Ctor({ latencyHint: 'interactive' })
    this.#ctx = ctx

    // Limiter: a compressor with a high ratio and fast attack. This is the
    // single most important node in the graph — without it, a coin burst
    // layered over engine noise and music clips hard.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.15

    const master = ctx.createGain()
    master.gain.value = this.#muted ? 0 : this.#masterVolume
    this.#master = master

    limiter.connect(master)
    master.connect(ctx.destination)

    for (const name of ['sfx', 'music', 'ui', 'ambient'] as const) {
      const gain = ctx.createGain()
      gain.gain.value = DEFAULT_BUS_VOLUMES[name]
      gain.connect(limiter)
      this.#buses.set(name, { gain, volume: DEFAULT_BUS_VOLUMES[name] })
    }

    this.#noiseBuffer = this.#createNoiseBuffer(ctx, 2)
    this.attachUnlockHandlers()
  }

  /**
   * Resume the context on the first user gesture. Browsers block audio until
   * then; this makes the unlock invisible to the player.
   */
  attachUnlockHandlers(): void {
    if (this.#unlockHandlersAttached || !this.#ctx) return
    this.#unlockHandlersAttached = true

    const unlock = (): void => {
      void this.resume()
    }

    for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
      window.addEventListener(event, unlock, { once: false, passive: true })
    }
  }

  async resume(): Promise<void> {
    const ctx = this.#ctx
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // Still blocked; the next gesture will try again.
        return
      }
    }
    this.#unlocked = ctx.state === 'running'
  }

  async suspend(): Promise<void> {
    const ctx = this.#ctx
    if (!ctx || ctx.state !== 'running') return
    try {
      await ctx.suspend()
    } catch {
      // Non-fatal.
    }
  }

  get unlocked(): boolean {
    return this.#unlocked
  }

  // ----------------------------------------------------------------- mixing

  setMasterVolume(volume: number): void {
    this.#masterVolume = Math.max(0, Math.min(1, volume))
    if (this.#master && !this.#muted) {
      this.#rampGain(this.#master.gain, this.#masterVolume, 0.05)
    }
  }

  get masterVolume(): number {
    return this.#masterVolume
  }

  setMuted(muted: boolean): void {
    this.#muted = muted
    if (this.#master) {
      this.#rampGain(this.#master.gain, muted ? 0 : this.#masterVolume, 0.08)
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.#muted)
    return this.#muted
  }

  setBusVolume(name: BusName, volume: number): void {
    const bus = this.#buses.get(name)
    if (!bus) return
    bus.volume = Math.max(0, Math.min(1, volume))
    this.#rampGain(bus.gain.gain, bus.volume, 0.05)
  }

  getBusVolume(name: BusName): number {
    return this.#buses.get(name)?.volume ?? 0
  }

  /** The node sounds on a given bus should connect to. */
  getBusNode(name: BusName): GainNode | null {
    return this.#buses.get(name)?.gain ?? null
  }

  /**
   * Temporarily duck a bus, e.g. pulling music down under a fanfare.
   *
   * @param amount multiplier to duck to, 0..1
   * @param duration seconds to hold before recovering
   */
  duck(name: BusName, amount: number, duration: number, recoverTime = 0.4): void {
    const bus = this.#buses.get(name)
    const ctx = this.#ctx
    if (!bus || !ctx) return

    const now = ctx.currentTime
    const target = bus.volume * Math.max(0, Math.min(1, amount))

    bus.gain.gain.cancelScheduledValues(now)
    bus.gain.gain.setValueAtTime(bus.gain.gain.value, now)
    bus.gain.gain.linearRampToValueAtTime(target, now + 0.05)
    bus.gain.gain.setValueAtTime(target, now + duration)
    bus.gain.gain.linearRampToValueAtTime(bus.volume, now + duration + recoverTime)
  }

  // ----------------------------------------------------------------- voices

  /**
   * Reserve a voice and get the gain node to build a sound onto.
   *
   * Returns null when audio is unavailable or the sound was throttled, so
   * every recipe must handle a null and simply not play.
   *
   * @param key identifies the sound for retrigger throttling
   * @param minInterval minimum seconds between two plays of `key`
   */
  allocateVoice(
    bus: BusName,
    duration: number,
    options: { key?: string; minInterval?: number; priority?: number } = {},
  ): { ctx: AudioContext; output: GainNode; startTime: number; noiseBuffer: AudioBuffer | null } | null {
    const ctx = this.#ctx
    const busNode = this.#buses.get(bus)
    if (!ctx || !busNode || ctx.state === 'closed') return null

    const now = ctx.currentTime

    if (options.key) {
      const minInterval = options.minInterval ?? 0.03
      const last = this.#lastPlayed.get(options.key)
      if (last !== undefined && now - last < minInterval) return null
      this.#lastPlayed.set(options.key, now)
    }

    this.#reapVoices(now)

    if (this.#voices.length >= this.#maxVoices) {
      if (!this.#stealVoice(options.priority ?? 1, now)) return null
    }

    const output = ctx.createGain()
    output.gain.value = 1
    output.connect(busNode.gain)

    const voice: Voice = {
      sources: [],
      gain: output,
      endTime: now + duration,
      bus,
      priority: options.priority ?? 1,
    }
    this.#voices.push(voice)

    // Disconnect once the sound is done so the graph doesn't grow unbounded.
    const cleanupDelay = Math.max(0, duration) * 1000 + 200
    setTimeout(() => {
      const index = this.#voices.indexOf(voice)
      if (index >= 0) this.#voices.splice(index, 1)
      try {
        output.disconnect()
      } catch {
        // Already disconnected.
      }
    }, cleanupDelay)

    return { ctx, output, startTime: now, noiseBuffer: this.#noiseBuffer }
  }

  /** Register a source with the most recently allocated voice, so it can be stolen. */
  registerSource(source: AudioScheduledSourceNode): void {
    const voice = this.#voices[this.#voices.length - 1]
    voice?.sources.push(source)
  }

  /** A buffer of white noise, for tyres, wind, and percussive sounds. */
  get noiseBuffer(): AudioBuffer | null {
    return this.#noiseBuffer
  }

  /** Stop everything immediately. Used when navigating away or on hard mute. */
  stopAll(): void {
    const now = this.now
    for (const voice of this.#voices) {
      this.#killVoice(voice, now)
    }
    this.#voices = []
  }

  dispose(): void {
    this.stopAll()
    void this.#ctx?.close()
    this.#ctx = null
    this.#master = null
    this.#buses.clear()
  }

  // -------------------------------------------------------------- internals

  #reapVoices(now: number): void {
    if (this.#voices.length === 0) return
    this.#voices = this.#voices.filter((v) => v.endTime > now)
  }

  /** Kill the lowest-priority, soonest-ending voice. Returns false if none qualify. */
  #stealVoice(incomingPriority: number, now: number): boolean {
    let bestIndex = -1
    let bestScore = Infinity

    for (let i = 0; i < this.#voices.length; i++) {
      const v = this.#voices[i]!
      if (v.priority > incomingPriority) continue
      // Prefer stealing low priority, then whichever finishes soonest.
      const score = v.priority * 1000 + (v.endTime - now)
      if (score < bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    if (bestIndex < 0) return false

    const victim = this.#voices[bestIndex]!
    this.#killVoice(victim, now)
    this.#voices.splice(bestIndex, 1)
    return true
  }

  #killVoice(voice: Voice, now: number): void {
    // Fade out over 20ms rather than cutting, which would click.
    try {
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
      voice.gain.gain.linearRampToValueAtTime(0, now + 0.02)
    } catch {
      // Node may already be disconnected.
    }

    for (const source of voice.sources) {
      try {
        source.stop(now + 0.025)
      } catch {
        // Already stopped, or never started.
      }
    }
  }

  #rampGain(param: AudioParam, value: number, seconds: number): void {
    const ctx = this.#ctx
    if (!ctx) return
    const now = ctx.currentTime
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    param.linearRampToValueAtTime(value, now + seconds)
  }

  #createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Deterministic noise so the sound is identical every run.
    let seed = 0x9e3779b9
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      data[i] = (seed / 0xffffffff) * 2 - 1
    }
    return buffer
  }
}

const DEFAULT_BUS_VOLUMES: Record<BusName, number> = {
  sfx: 0.85,
  music: 0.35,
  ui: 0.7,
  ambient: 0.3,
}
