/**
 * The application shell.
 *
 * Owns every engine subsystem, wires them together, and drives the frame.
 * Game-specific code receives this as a service locator rather than reaching
 * for globals, which keeps scenes testable and makes the dependency graph
 * explicit.
 */

import { TweenManager } from '../anim/tween.js'
import { AudioBus } from '../audio/audio-bus.js'
import { ParticleSystem } from '../fx/particles.js'
import { InputManager, type ActionMap } from '../input/input.js'
import { Camera } from '../render/camera.js'
import { Viewport } from '../render/viewport.js'
import { GameLoop, type LoopStats } from './loop.js'
import { type Scene, SceneStack } from './scene.js'
import { SettingsManager, type Settings } from './settings.js'

export interface GameOptions {
  canvas: HTMLCanvasElement
  /** Named action bindings for keyboard and gamepad. */
  actions?: ActionMap
  /** Simulation rate. */
  updateHz?: number
  /** Particle pool size. */
  particleCapacity?: number
  initialSettings?: Partial<Settings>
}

export class Game {
  readonly viewport: Viewport
  readonly camera: Camera
  readonly input: InputManager
  readonly audio: AudioBus
  readonly particles: ParticleSystem
  readonly tweens: TweenManager
  readonly scenes: SceneStack
  readonly settings: SettingsManager
  readonly loop: GameLoop

  /** Seconds of simulated time since start. Deterministic, unlike wall clock. */
  #elapsed = 0

  constructor(options: GameOptions) {
    this.settings = new SettingsManager(options.initialSettings)

    // Order matters: `new Viewport` measures and fires `onResize` synchronously
    // from its own constructor, so every field that callback touches must
    // already exist.
    this.camera = new Camera()
    this.camera.shakeScale = this.settings.shakeScale
    this.scenes = new SceneStack()

    this.viewport = new Viewport(options.canvas, {
      maxDpr: this.settings.maxDpr,
      onResize: (width, height) => {
        this.camera.setViewportSize(width, height)
        this.scenes.resize(width, height)
      },
    })
    this.camera.setViewportSize(this.viewport.width, this.viewport.height)

    this.input = new InputManager(this.viewport, options.actions ?? {})
    this.audio = new AudioBus()
    this.particles = new ParticleSystem(options.particleCapacity ?? 1200)
    this.particles.intensity = this.settings.particleScale
    this.tweens = new TweenManager()

    this.loop = new GameLoop(
      {
        update: (dt) => this.#update(dt),
        render: (alpha, frameDt) => this.#render(alpha, frameDt),
      },
      { updateHz: options.updateHz ?? 60 },
    )

    // Quality changes have to be pushed into the subsystems that consume them.
    this.settings.events.on('qualityChanged', () => this.#applyQuality())
    this.settings.events.on('changed', () => this.#applySettings())
  }

  get elapsed(): number {
    return this.#elapsed
  }

  get stats(): Readonly<LoopStats> {
    return this.loop.stats
  }

  /** Boot the audio graph and start the frame loop. */
  start(initialScene: Scene): void {
    this.audio.init()
    this.#applySettings()
    this.scenes.replace(initialScene)
    // `replace` is queued; flush it so the first frame has a scene to draw.
    this.scenes.update(0)
    this.scenes.resize(this.viewport.width, this.viewport.height)
    this.loop.start()
  }

  stop(): void {
    this.loop.stop()
  }

  dispose(): void {
    this.loop.stop()
    this.scenes.clear()
    this.input.dispose()
    this.viewport.dispose()
    this.settings.dispose()
    this.audio.dispose()
    this.tweens.clear()
    this.particles.clear()
  }

  #update(dt: number): void {
    this.#elapsed += dt

    this.input.update(dt)
    this.scenes.update(dt)
    this.camera.update(dt)
    this.particles.update(dt)
    this.input.postUpdate()
  }

  #render(alpha: number, frameDt: number): void {
    // UI animation runs on real time so it stays smooth while the world is
    // paused behind a modal.
    this.tweens.update(frameDt)

    this.settings.observeFrameRate(this.loop.stats.fps, frameDt)

    const ctx = this.viewport.beginFrame()
    this.scenes.render(ctx, alpha, frameDt)
  }

  #applyQuality(): void {
    this.viewport.setMaxDpr(this.settings.maxDpr)
    this.particles.intensity = this.settings.particleScale
  }

  #applySettings(): void {
    const s = this.settings.settings
    this.audio.setMuted(s.muted)
    this.audio.setMasterVolume(s.masterVolume)
    this.audio.setBusVolume('music', s.musicEnabled ? 0.35 : 0)
    this.camera.shakeScale = this.settings.shakeScale
    this.particles.intensity = this.settings.particleScale
  }
}
