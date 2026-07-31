/**
 * The car, built from rounded primitives.
 *
 * Proportions are deliberately toy-like rather than accurate: the wheels are
 * oversized, the cabin is tall relative to the body, and every edge carries a
 * generous radius. That combination is what makes a vehicle read as
 * *friendly* — real car proportions look severe next to it.
 *
 * The whole car is one Group with named parts, so gameplay can animate the
 * wheels, dip the body under braking and flash the brake lights without
 * knowing how any of it is built.
 */

import {
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  type BufferGeometry,
  type Material,
} from 'three'

import {
  headGeometry,
  plateGeometry,
  roundedBoxGeometry,
  wheelGeometry,
} from '../../engine/three/geometry.js'
import type { VehicleArt } from '../../content/vehicles.js'

export interface CarParts {
  root: Group
  /** Everything that should dip/roll with the suspension. */
  body: Group
  wheels: Mesh[]
  /** Front wheels, which also steer. */
  steeredWheels: Mesh[]
  brakeLights: Mesh[]
  headlights: Mesh[]
  /** Geometries and materials this car owns, for disposal. */
  disposables: Array<BufferGeometry | Material>
}

export interface CarModelOptions {
  art: VehicleArt
  /** Body paint colour, 0xRRGGBB. */
  paint: number
}

/** Shared across every car; created once, disposed by the scene. */
export interface CarSharedMaterials {
  tyre: MeshLambertMaterial
  rim: MeshLambertMaterial
  glass: MeshPhongMaterial
  light: MeshLambertMaterial
  brake: MeshLambertMaterial
  trim: MeshLambertMaterial
}

export function createCarMaterials(): CarSharedMaterials {
  return {
    tyre: new MeshLambertMaterial({ color: 0x2b2b33 }),
    rim: new MeshLambertMaterial({ color: 0xdfe3ea }),
    // Slight shine on the glass sells it as glass without a reflection probe.
    glass: new MeshPhongMaterial({
      color: 0x9fd8ef,
      shininess: 90,
      specular: 0x6688aa,
      transparent: true,
      opacity: 0.85,
    }),
    light: new MeshLambertMaterial({ color: 0xfff6c9, emissive: 0xfff0b0, emissiveIntensity: 0.6 }),
    brake: new MeshLambertMaterial({ color: 0xff5a5a, emissive: 0x400000, emissiveIntensity: 1 }),
    trim: new MeshLambertMaterial({ color: 0x3a3f4b }),
  }
}

export function disposeCarMaterials(materials: CarSharedMaterials): void {
  for (const m of Object.values(materials)) m.dispose()
}

/**
 * Build a car.
 *
 * The art data uses the 2D game's units (a taxi is 48 long); 3D world units
 * are metres-ish, so everything is scaled down by {@link ART_TO_WORLD}. This
 * keeps the vehicle content file as the single source of proportions.
 */
export const ART_TO_WORLD = 1 / 12

export function createCar(options: CarModelOptions, shared: CarSharedMaterials): CarParts {
  const { art, paint } = options
  const disposables: Array<BufferGeometry | Material> = []

  const length = art.length * ART_TO_WORLD
  const width = art.width * ART_TO_WORLD
  // Height is not in the art data (it was a top-down game); derive it from
  // width so bigger vehicles are proportionally taller.
  const bodyHeight = width * 0.52
  const wheelRadius = width * 0.29
  const wheelWidth = width * 0.17

  const root = new Group()
  const body = new Group()
  root.add(body)

  const paintMaterial = new MeshPhongMaterial({
    color: paint,
    shininess: 60,
    specular: 0x333333,
  })
  disposables.push(paintMaterial)

  // -- Lower body --------------------------------------------------------
  const lowerGeo = roundedBoxGeometry(length, bodyHeight, width, Math.min(width, bodyHeight) * 0.32)
  disposables.push(lowerGeo)
  const lower = new Mesh(lowerGeo, paintMaterial)
  lower.position.y = wheelRadius + bodyHeight * 0.42
  lower.castShadow = true
  lower.receiveShadow = true
  body.add(lower)

  // -- Cabin -------------------------------------------------------------
  // Longer cabins are what make a bus read as a bus.
  const cabinLength = length * (0.3 + art.sideWindows * 0.11)
  const cabinHeight = bodyHeight * 0.78
  const cabinWidth = width * 0.86
  const cabinGeo = roundedBoxGeometry(
    cabinLength,
    cabinHeight,
    cabinWidth,
    Math.min(cabinWidth, cabinHeight) * 0.3,
  )
  disposables.push(cabinGeo)
  const cabin = new Mesh(cabinGeo, paintMaterial)
  cabin.position.set(-length * 0.04, lower.position.y + bodyHeight * 0.46 + cabinHeight * 0.34, 0)
  cabin.castShadow = true
  body.add(cabin)

  // Glass wraps the cabin as a slightly smaller, slightly lower box.
  const glassGeo = roundedBoxGeometry(
    cabinLength * 0.9,
    cabinHeight * 0.56,
    cabinWidth * 1.02,
    cabinHeight * 0.16,
  )
  disposables.push(glassGeo)
  const glass = new Mesh(glassGeo, shared.glass)
  glass.position.copy(cabin.position)
  glass.position.y += cabinHeight * 0.06
  body.add(glass)

  // -- Wheels ------------------------------------------------------------
  const wheelGeo = wheelGeometry(wheelRadius, wheelWidth)
  disposables.push(wheelGeo)
  const rimGeo = headGeometry(wheelRadius * 0.42, 1, 10)
  disposables.push(rimGeo)

  const wheels: Mesh[] = []
  const steeredWheels: Mesh[] = []
  const axleX = length * 0.3
  const axleZ = width * 0.5 - wheelWidth * 0.25

  for (const [ax, az, steered] of [
    [axleX, -axleZ, true],
    [axleX, axleZ, true],
    [-axleX, -axleZ, false],
    [-axleX, axleZ, false],
  ] as const) {
    // A pivot lets the front wheels yaw for steering without fighting the
    // rolling rotation applied to the wheel mesh itself.
    const pivot = new Group()
    pivot.position.set(ax, wheelRadius, az)
    body.add(pivot)

    const wheel = new Mesh(wheelGeo, shared.tyre)
    wheel.castShadow = true
    pivot.add(wheel)

    const rim = new Mesh(rimGeo, shared.rim)
    rim.position.z = az > 0 ? wheelWidth * 0.52 : -wheelWidth * 0.52
    wheel.add(rim)

    wheels.push(wheel)
    if (steered) steeredWheels.push(pivot as unknown as Mesh)
  }

  // -- Lights ------------------------------------------------------------
  const lightGeo = headGeometry(width * 0.1, 0.7, 10)
  disposables.push(lightGeo)

  const headlights: Mesh[] = []
  for (const z of [-width * 0.3, width * 0.3]) {
    const light = new Mesh(lightGeo, shared.light)
    light.position.set(length * 0.49, lower.position.y, z)
    light.scale.x = 0.5
    body.add(light)
    headlights.push(light)
  }

  const brakeLights: Mesh[] = []
  for (const z of [-width * 0.3, width * 0.3]) {
    const light = new Mesh(lightGeo, shared.brake)
    light.position.set(-length * 0.49, lower.position.y, z)
    light.scale.x = 0.5
    body.add(light)
    brakeLights.push(light)
  }

  // -- Optional details ---------------------------------------------------
  if (art.hasSign) {
    const signGeo = roundedBoxGeometry(cabinLength * 0.3, cabinHeight * 0.3, cabinWidth * 0.4, 0.03)
    disposables.push(signGeo)
    const signMat = new MeshLambertMaterial({
      color: 0xffc93c,
      emissive: 0x996600,
      emissiveIntensity: 0.5,
    })
    disposables.push(signMat)
    const sign = new Mesh(signGeo, signMat)
    sign.position.set(cabin.position.x, cabin.position.y + cabinHeight * 0.62, 0)
    sign.castShadow = true
    body.add(sign)
  }

  if (art.hasStripe) {
    const stripeGeo = roundedBoxGeometry(length * 0.94, bodyHeight * 0.16, width * 1.03, 0.03)
    disposables.push(stripeGeo)
    const stripe = new Mesh(stripeGeo, shared.trim)
    stripe.position.set(0, lower.position.y - bodyHeight * 0.16, 0)
    body.add(stripe)
  }

  // A soft contact shadow under the car. The real shadow map handles the sun;
  // this fills the dark contact patch that a low-res map cannot resolve.
  const blobGeo = plateGeometry(length * 1.05, width * 1.15, width * 0.4)
  disposables.push(blobGeo)
  const blobMat = new MeshLambertMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })
  disposables.push(blobMat)
  const blob = new Mesh(blobGeo, blobMat)
  blob.position.y = 0.02
  root.add(blob)

  return { root, body, wheels, steeredWheels, brakeLights, headlights, disposables }
}

/** Free everything a car owns. Shared materials are not touched. */
export function disposeCar(parts: CarParts): void {
  for (const d of parts.disposables) d.dispose()
  parts.disposables.length = 0
}
