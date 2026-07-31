/**
 * Lighting, sky and fog — the things that make a scene read as a place
 * rather than a pile of coloured shapes.
 *
 * The recipe is deliberately simple and cheap:
 * - One directional "sun" casting shadows, angled so buildings throw long,
 *   readable shadows onto the road. Shadows are what sell 3D depth more than
 *   any other single effect.
 * - A hemisphere light providing warm sky bounce and cool ground bounce, so
 *   the shadowed side of an object is coloured rather than black. This is the
 *   whole difference between "cheerful" and "grim".
 * - Distance fog matched to the sky colour, which hides the draw-distance cut
 *   and adds aerial perspective for free.
 *
 * The sun's shadow camera follows the player, because a shadow map large
 * enough to cover the whole town would be far too coarse to resolve a car.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Scene,
  type Object3D,
} from 'three'

export interface EnvironmentOptions {
  /** Sky and fog colour. */
  skyColor?: number
  /** Light bouncing up off the ground. */
  groundColor?: number
  sunColor?: number
  /** Shadow map resolution; 0 disables shadows. */
  shadowMapSize?: number
  /** Half-width of the shadow camera's box, in world units. */
  shadowRadius?: number
  fogNear?: number
  fogFar?: number
}

export class Environment {
  readonly scene: Scene
  readonly sun: DirectionalLight
  readonly hemisphere: HemisphereLight
  readonly ambient: AmbientLight

  #shadowRadius: number

  constructor(scene: Scene, options: EnvironmentOptions = {}) {
    this.scene = scene

    const sky = new Color(options.skyColor ?? 0x8fd0f0)
    scene.background = sky
    scene.fog = new Fog(sky.getHex(), options.fogNear ?? 70, options.fogFar ?? 210)

    this.hemisphere = new HemisphereLight(
      options.skyColor ?? 0xbfe6ff,
      options.groundColor ?? 0x6b8f5a,
      1.05,
    )
    this.hemisphere.position.set(0, 50, 0)
    scene.add(this.hemisphere)

    // A little flat ambient stops deep shadow from crushing to pure black,
    // which reads as scary rather than sunny.
    this.ambient = new AmbientLight(0xffffff, 0.22)
    scene.add(this.ambient)

    this.sun = new DirectionalLight(options.sunColor ?? 0xfff2d5, 1.45)
    this.sun.position.set(28, 44, 18)
    scene.add(this.sun)
    // A directional light aims at its target's position, so the target must
    // be in the scene graph for its world matrix to update.
    scene.add(this.sun.target)

    this.#shadowRadius = options.shadowRadius ?? 26
    this.setShadowMapSize(options.shadowMapSize ?? 2048)
  }

  /** Resize or disable the shadow map. 0 turns shadows off entirely. */
  setShadowMapSize(size: number): void {
    if (size <= 0) {
      this.sun.castShadow = false
      return
    }

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(size, size)

    const r = this.#shadowRadius
    const cam = this.sun.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 1
    cam.far = 140
    cam.updateProjectionMatrix()

    // Bias fights shadow acne on the large flat road; normalBias handles the
    // rounded geometry where a constant bias would cause peter-panning.
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.035

    // Freeing the old map matters when the tier changes mid-session.
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
  }

  /**
   * Keep the shadow camera centred on the player.
   *
   * Snapping to a grid rather than following continuously stops the shadow
   * texels from swimming as the camera moves — a very visible artefact
   * otherwise, especially on straight road edges.
   */
  followTarget(x: number, y: number, z: number): void {
    if (!this.sun.castShadow) {
      this.sun.target.position.set(x, y, z)
      this.sun.position.set(x + 28, y + 44, z + 18)
      return
    }

    const texelSize = (this.#shadowRadius * 2) / this.sun.shadow.mapSize.x
    const snappedX = Math.round(x / texelSize) * texelSize
    const snappedZ = Math.round(z / texelSize) * texelSize

    this.sun.target.position.set(snappedX, y, snappedZ)
    this.sun.target.updateMatrixWorld()
    this.sun.position.set(snappedX + 28, y + 44, snappedZ + 18)
  }

  /** Add an object that should be lit by this environment. */
  add(object: Object3D): void {
    this.scene.add(object)
  }

  dispose(): void {
    this.sun.shadow.map?.dispose()
    this.scene.remove(this.sun, this.sun.target, this.hemisphere, this.ambient)
    this.sun.dispose()
    this.hemisphere.dispose()
    this.ambient.dispose()
  }
}
