/**
 * A scene stack.
 *
 * Scenes are the game's top-level modes: the town you drive around, the
 * garage, the shop, the celebration overlay. A stack rather than a single
 * "current scene" because overlays need the scene below them to keep
 * rendering — opening the shop should show the town dimmed behind it, not a
 * black void, which is far less disorienting for a young player.
 *
 * Each scene declares whether the scenes below it should keep updating and
 * keep rendering, so a modal shop can freeze the world while a floating
 * tutorial hand lets it carry on.
 */

export interface SceneContext {
  /** Push a scene on top of this one. */
  push(scene: Scene): void
  /** Pop this scene off. */
  pop(): void
  /** Replace the entire stack with one scene. */
  replace(scene: Scene): void
  /** Pop until `scene` is on top. */
  popTo(scene: Scene): void
}

export interface Scene {
  /** For debugging and analytics. */
  readonly name: string

  /**
   * When false, scenes below this one stop receiving `update`. Default true
   * for overlays that should freeze the world.
   */
  readonly blocksUpdate?: boolean

  /**
   * When false, scenes below this one stop being rendered. Almost always
   * true — see the module docs.
   */
  readonly blocksRender?: boolean

  /** Called once when the scene is added to the stack. */
  enter?(ctx: SceneContext): void

  /** Called once when the scene is removed. Release listeners here. */
  exit?(): void

  /** Called when another scene is pushed on top. */
  obscured?(): void

  /** Called when the scene above is popped and this becomes the top again. */
  revealed?(): void

  /** Fixed-timestep simulation. */
  update?(fixedDt: number): void

  /**
   * Draw. `alpha` is the fixed-timestep interpolation factor; `frameDt` is
   * real elapsed time, for cosmetic-only animation.
   */
  render?(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number): void

  /** Viewport size changed, in CSS pixels. */
  resize?(width: number, height: number): void
}

export class SceneStack implements SceneContext {
  readonly #scenes: Scene[] = []

  /**
   * Structural changes are deferred to the end of the frame. Mutating the
   * stack from inside a scene's `update` would otherwise invalidate the
   * iteration in progress — the classic source of "scene updated after exit"
   * bugs.
   */
  readonly #commands: Array<() => void> = []

  get current(): Scene | null {
    return this.#scenes[this.#scenes.length - 1] ?? null
  }

  get depth(): number {
    return this.#scenes.length
  }

  /** Names bottom-to-top, for the debug overlay. */
  get stackNames(): string[] {
    return this.#scenes.map((s) => s.name)
  }

  push(scene: Scene): void {
    this.#commands.push(() => {
      this.current?.obscured?.()
      this.#scenes.push(scene)
      scene.enter?.(this)
      scene.resize?.(this.#lastWidth, this.#lastHeight)
    })
  }

  pop(): void {
    this.#commands.push(() => {
      const scene = this.#scenes.pop()
      scene?.exit?.()
      this.current?.revealed?.()
    })
  }

  replace(scene: Scene): void {
    this.#commands.push(() => {
      while (this.#scenes.length > 0) {
        this.#scenes.pop()?.exit?.()
      }
      this.#scenes.push(scene)
      scene.enter?.(this)
      scene.resize?.(this.#lastWidth, this.#lastHeight)
    })
  }

  popTo(scene: Scene): void {
    this.#commands.push(() => {
      while (this.#scenes.length > 1 && this.current !== scene) {
        this.#scenes.pop()?.exit?.()
      }
      this.current?.revealed?.()
    })
  }

  #lastWidth = 0
  #lastHeight = 0

  resize(width: number, height: number): void {
    this.#lastWidth = width
    this.#lastHeight = height
    for (const scene of this.#scenes) scene.resize?.(width, height)
  }

  update(fixedDt: number): void {
    // Walk down from the top until something blocks, collecting the scenes
    // that should tick, then run them bottom-up so the world updates before
    // the UI that reads it.
    const startIndex = this.#findUpdateFloor()
    for (let i = startIndex; i < this.#scenes.length; i++) {
      this.#scenes[i]!.update?.(fixedDt)
    }
    this.#flushCommands()
  }

  render(ctx: CanvasRenderingContext2D, alpha: number, frameDt: number): void {
    const startIndex = this.#findRenderFloor()
    for (let i = startIndex; i < this.#scenes.length; i++) {
      this.#scenes[i]!.render?.(ctx, alpha, frameDt)
    }
  }

  /** Tear down every scene. Called on teardown/hot-reload. */
  clear(): void {
    this.#commands.length = 0
    while (this.#scenes.length > 0) {
      this.#scenes.pop()?.exit?.()
    }
  }

  #findUpdateFloor(): number {
    for (let i = this.#scenes.length - 1; i > 0; i--) {
      if (this.#scenes[i]!.blocksUpdate ?? true) return i
    }
    return 0
  }

  #findRenderFloor(): number {
    for (let i = this.#scenes.length - 1; i > 0; i--) {
      if (this.#scenes[i]!.blocksRender ?? false) return i
    }
    return 0
  }

  #flushCommands(): void {
    // A command may itself queue another (enter() pushing a sub-scene), so
    // drain rather than iterate a snapshot. The cap catches accidental
    // infinite push/pop loops instead of hanging the tab.
    let guard = 0
    while (this.#commands.length > 0) {
      if (++guard > 64) {
        this.#commands.length = 0
        throw new Error('SceneStack: scene transition loop detected')
      }
      const command = this.#commands.shift()!
      command()
    }
  }
}
