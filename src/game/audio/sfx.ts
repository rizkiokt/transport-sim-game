/**
 * Sound effects, synthesised from oscillators and filtered noise.
 *
 * Recipes aim for "friendly toy", not realism: short envelopes, musical
 * intervals, and a pentatonic bias so overlapping sounds never clash.
 * Every function tolerates audio being unavailable (voice comes back null)
 * and simply does nothing — sound is seasoning, never load-bearing.
 */

import type { AudioBus } from '../../engine/audio/audio-bus.js'
import { cosmeticRng } from '../../engine/math/rng.js'

/** C major pentatonic around the fifth octave — the "can't sound bad" scale. */
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0]

function tone(
  bus: AudioBus,
  opts: {
    freq: number
    endFreq?: number
    type?: OscillatorType
    duration: number
    gain?: number
    delay?: number
    busName?: 'sfx' | 'ui'
    key?: string
    detune?: boolean
  },
): void {
  const duration = opts.duration + (opts.delay ?? 0)
  const voice = bus.allocateVoice(opts.busName ?? 'sfx', duration + 0.05, {
    ...(opts.key !== undefined ? { key: opts.key, minInterval: 0.04 } : {}),
  })
  if (!voice) return

  const { ctx, output, startTime } = voice
  const start = startTime + (opts.delay ?? 0)
  const gain = opts.gain ?? 0.25

  const osc = ctx.createOscillator()
  osc.type = opts.type ?? 'triangle'
  let freq = opts.freq
  if (opts.detune) freq *= 1 + cosmeticRng.range(-0.02, 0.02)
  osc.frequency.setValueAtTime(freq, start)
  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), start + opts.duration)
  }

  output.gain.setValueAtTime(0, start)
  output.gain.linearRampToValueAtTime(gain, start + 0.012)
  output.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration)

  osc.connect(output)
  osc.start(start)
  osc.stop(start + opts.duration + 0.02)
  bus.registerSource(osc)
}

/** A single coin: bright chime with random detune so bursts sparkle. */
export function playCoin(bus: AudioBus, index = 0): void {
  const note = PENTATONIC[(index + 2) % PENTATONIC.length]! * 2
  tone(bus, {
    freq: note,
    type: 'sine',
    duration: 0.22,
    gain: 0.16,
    delay: index * 0.055,
    detune: true,
  })
  // A faint upper partial makes it "metallic".
  tone(bus, {
    freq: note * 2.01,
    type: 'sine',
    duration: 0.12,
    gain: 0.05,
    delay: index * 0.055,
    detune: true,
  })
}

/** Passenger hop-in: a happy rising two-note blip. */
export function playPickup(bus: AudioBus): void {
  tone(bus, { freq: 523.25, endFreq: 587, type: 'triangle', duration: 0.1, gain: 0.22, key: 'pickup' })
  tone(bus, { freq: 783.99, endFreq: 880, type: 'triangle', duration: 0.16, gain: 0.22, delay: 0.09 })
  // A tiny "voice" squeak — the passenger saying hello.
  tone(bus, {
    freq: cosmeticRng.range(700, 950),
    endFreq: cosmeticRng.range(1000, 1250),
    type: 'square',
    duration: 0.07,
    gain: 0.045,
    delay: 0.2,
  })
}

/** Dropoff fanfare: ascending pentatonic triad with a sparkle on top. */
export function playDropoff(bus: AudioBus): void {
  // Duck ambience under the fanfare so it lands clearly.
  bus.duck('ambient', 0.4, 0.7)

  tone(bus, { freq: 523.25, type: 'triangle', duration: 0.3, gain: 0.2, key: 'dropoff' })
  tone(bus, { freq: 659.25, type: 'triangle', duration: 0.3, gain: 0.2, delay: 0.09 })
  tone(bus, { freq: 783.99, type: 'triangle', duration: 0.3, gain: 0.2, delay: 0.18 })
  tone(bus, { freq: 1567.98, type: 'sine', duration: 0.4, gain: 0.1, delay: 0.28 })
}

/** The horn: a cheerful two-tone beep-beep. Pure joy button. */
export function playHorn(bus: AudioBus): void {
  const voice = bus.allocateVoice('sfx', 0.4, { key: 'horn', minInterval: 0.15, priority: 2 })
  if (!voice) return
  const { ctx, output, startTime } = voice

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 1600
  filter.Q.value = 2
  filter.connect(output)

  for (const [delay, freq] of [
    [0, 440],
    [0.16, 554.37],
  ] as const) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, startTime + delay)
    g.gain.linearRampToValueAtTime(0.16, startTime + delay + 0.015)
    g.gain.setValueAtTime(0.16, startTime + delay + 0.09)
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + delay + 0.15)
    osc.connect(g)
    g.connect(filter)
    osc.start(startTime + delay)
    osc.stop(startTime + delay + 0.17)
    bus.registerSource(osc)
  }
}

/** A soft "bonk" for bumping obstacles: filtered noise thump, never harsh. */
export function playBonk(bus: AudioBus, severity: number): void {
  const voice = bus.allocateVoice('sfx', 0.3, { key: 'bonk', minInterval: 0.25 })
  if (!voice || !voice.noiseBuffer) return
  const { ctx, output, startTime, noiseBuffer } = voice

  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 260
  filter.Q.value = 1.2

  const gain = Math.min(0.3, 0.12 + severity * 0.001)
  output.gain.setValueAtTime(gain, startTime)
  output.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.22)

  src.connect(filter)
  filter.connect(output)
  src.start(startTime, cosmeticRng.range(0, 1), 0.25)
  bus.registerSource(src)

  // A descending "boing" underneath makes it comedic rather than alarming.
  tone(bus, { freq: 180, endFreq: 70, type: 'sine', duration: 0.2, gain: 0.18 })
}

/** UI tap feedback. */
export function playClick(bus: AudioBus): void {
  tone(bus, { freq: 880, type: 'sine', duration: 0.06, gain: 0.12, busName: 'ui', key: 'click' })
}

/** The big start-of-game chord. */
export function playStart(bus: AudioBus): void {
  const notes = [261.63, 329.63, 392.0, 523.25]
  notes.forEach((freq, i) => {
    tone(bus, { freq, type: 'triangle', duration: 0.5, gain: 0.13, delay: i * 0.05, busName: 'ui' })
  })
}

/**
 * The continuous engine hum: two detuned oscillators through a lowpass,
 * pitch and volume tracking speed. Created once per scene and updated every
 * frame — this is the one sound that is a persistent graph, not a one-shot.
 */
export class EngineSound {
  #bus: AudioBus
  #started = false
  #osc1: OscillatorNode | null = null
  #osc2: OscillatorNode | null = null
  #gain: GainNode | null = null
  #filter: BiquadFilterNode | null = null

  constructor(bus: AudioBus) {
    this.#bus = bus
  }

  /** Call every frame with speed 0..1 (fraction of top speed). */
  update(speedFraction: number): void {
    if (!this.#started) {
      // Audio unlocks on the first gesture; keep trying until then.
      if (!this.#bus.isReady) return
      this.#start()
    }

    const ctx = this.#bus.context
    if (!ctx || !this.#osc1 || !this.#osc2 || !this.#gain || !this.#filter) return

    const now = ctx.currentTime
    const s = Math.max(0, Math.min(1, speedFraction))

    // Idle putter ~55Hz rising to ~135Hz at speed; the second oscillator sits
    // a rough fifth up and slightly detuned for width.
    const freq = 55 + s * 80
    this.#osc1.frequency.setTargetAtTime(freq, now, 0.08)
    this.#osc2.frequency.setTargetAtTime(freq * 1.5 + 3, now, 0.08)

    // Louder and brighter with speed, quiet at idle.
    this.#gain.gain.setTargetAtTime(0.015 + s * 0.05, now, 0.1)
    this.#filter.frequency.setTargetAtTime(220 + s * 480, now, 0.12)
  }

  #start(): void {
    const ctx = this.#bus.context
    const busNode = this.#bus.getBusNode('ambient')
    if (!ctx || !busNode) return

    this.#filter = ctx.createBiquadFilter()
    this.#filter.type = 'lowpass'
    this.#filter.frequency.value = 250
    this.#filter.Q.value = 0.8

    this.#gain = ctx.createGain()
    this.#gain.gain.value = 0

    this.#osc1 = ctx.createOscillator()
    this.#osc1.type = 'sawtooth'
    this.#osc1.frequency.value = 55

    this.#osc2 = ctx.createOscillator()
    this.#osc2.type = 'triangle'
    this.#osc2.frequency.value = 85

    this.#osc1.connect(this.#filter)
    this.#osc2.connect(this.#filter)
    this.#filter.connect(this.#gain)
    this.#gain.connect(busNode)

    this.#osc1.start()
    this.#osc2.start()
    this.#started = true
  }

  dispose(): void {
    try {
      this.#osc1?.stop()
      this.#osc2?.stop()
      this.#gain?.disconnect()
    } catch {
      // Already stopped.
    }
    this.#osc1 = null
    this.#osc2 = null
    this.#gain = null
    this.#filter = null
    this.#started = false
  }
}
