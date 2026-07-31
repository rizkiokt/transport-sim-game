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
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  type BufferGeometry,
  type Material,
} from 'three'

import {
  discGeometry,
  plateGeometry,
  roundedBoxGeometry,
  wheelGeometry,
} from '../../engine/three/geometry.js'
import type { VehicleArt } from '../../content/vehicles.js'

export interface CarParts {
  root: Group
  /** Everything that should dip/roll with the suspension. */
  body: Group
  /** Wheel meshes; roll these about their local Z. */
  wheels: Mesh[]
  /** Front-wheel steering pivots; yaw these about Y. */
  steeredWheels: Object3D[]
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

/**
 * Shared across every car; created once, disposed by the scene.
 *
 * These are physically-based rather than Lambert/Phong. The difference that
 * matters here is the environment map: a rough tyre stays matte, chrome trim
 * picks up the sky, and car paint gets a bright horizon reflection along its
 * upper edges. That reflection is what makes paint read as painted metal
 * instead of coloured plastic, and it costs nothing at runtime because the
 * environment is a small pre-filtered map generated once at startup.
 */
export interface CarSharedMaterials {
  tyre: MeshStandardMaterial
  rim: MeshStandardMaterial
  glass: MeshPhysicalMaterial
  light: MeshStandardMaterial
  brake: MeshStandardMaterial
  trim: MeshStandardMaterial
  chrome: MeshStandardMaterial
  plate: MeshStandardMaterial
}

export function createCarMaterials(): CarSharedMaterials {
  return {
    // Rubber: dark and almost fully rough, so it never catches a highlight.
    tyre: new MeshStandardMaterial({ color: 0x23232a, roughness: 0.92, metalness: 0 }),
    rim: new MeshStandardMaterial({
      color: 0xd8dde6,
      roughness: 0.28,
      metalness: 0.9,
      envMapIntensity: 1.1,
    }),
    glass: new MeshPhysicalMaterial({
      color: 0x6d98b5,
      roughness: 0.05,
      metalness: 0,
      transmission: 0,
      transparent: true,
      opacity: 0.55,
      // A clearcoat gives the second, sharper highlight real glazing has.
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.6,
    }),
    light: new MeshStandardMaterial({
      color: 0xfff6c9,
      emissive: 0xfff0b0,
      emissiveIntensity: 0.55,
      roughness: 0.15,
      metalness: 0,
    }),
    brake: new MeshStandardMaterial({
      color: 0xd23a3a,
      emissive: 0x4a0000,
      emissiveIntensity: 1,
      roughness: 0.25,
      metalness: 0,
    }),
    trim: new MeshStandardMaterial({ color: 0x2f333d, roughness: 0.6, metalness: 0.2 }),
    chrome: new MeshStandardMaterial({
      color: 0xf0f3f7,
      roughness: 0.14,
      metalness: 1,
      envMapIntensity: 1.4,
    }),
    plate: new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, metalness: 0 }),
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

  // -- Proportions ---------------------------------------------------------
  // The art data came from the top-down game, where "width" was the whole
  // footprint. Taken literally it produces a car as wide as it is tall with
  // wheels the size of tractor tyres, so the 3D body is narrowed and the
  // wheels are sized against LENGTH — a real car's wheel is roughly a twelfth
  // of its length, whatever its width.
  const length = art.length * ART_TO_WORLD
  const bodyWidth = art.width * ART_TO_WORLD * 0.84

  const wheelRadius = length * 0.088
  const wheelWidth = bodyWidth * 0.14

  const clearance = wheelRadius * 0.52
  const lowerHeight = bodyWidth * 0.40
  const lowerY = clearance + lowerHeight / 2

  const root = new Group()
  const body = new Group()
  root.add(body)

  const paintMaterial = new MeshStandardMaterial({
    color: paint,
    roughness: 0.32,
    metalness: 0.35,
    envMapIntensity: 1.15,
  })
  disposables.push(paintMaterial)

  // -- Lower body ----------------------------------------------------------
  // A modest radius. Taking a third of the body height (the obvious choice)
  // rounds the top and bottom edges until they meet and the car reads as a
  // loaf of bread rather than a vehicle.
  const lowerGeo = roundedBoxGeometry(length, lowerHeight, bodyWidth, lowerHeight * 0.24)
  disposables.push(lowerGeo)
  const lower = new Mesh(lowerGeo, paintMaterial)
  lower.position.y = lowerY
  lower.castShadow = true
  lower.receiveShadow = true
  body.add(lower)

  // -- Cabin ---------------------------------------------------------------
  // Longer cabins are what make a bus read as a bus.
  const cabinLength = length * (0.3 + art.sideWindows * 0.1)
  const cabinHeight = lowerHeight * 0.66
  const cabinWidth = bodyWidth * 0.93
  const cabinY = lowerY + lowerHeight / 2 + cabinHeight / 2 - lowerHeight * 0.14
  const cabinX = -length * 0.05

  const cabinGeo = roundedBoxGeometry(cabinLength, cabinHeight, cabinWidth, cabinHeight * 0.26)
  disposables.push(cabinGeo)
  const cabin = new Mesh(cabinGeo, paintMaterial)
  cabin.position.set(cabinX, cabinY, 0)
  cabin.castShadow = true
  body.add(cabin)

  // Glass: a slightly wider, shorter box so it reads as a continuous band of
  // windows wrapping the cabin rather than as separate panes.
  const glassGeo = roundedBoxGeometry(
    cabinLength * 0.92,
    cabinHeight * 0.5,
    cabinWidth * 1.03,
    cabinHeight * 0.14,
  )
  disposables.push(glassGeo)
  const glass = new Mesh(glassGeo, shared.glass)
  glass.position.set(cabinX, cabinY + cabinHeight * 0.08, 0)
  body.add(glass)

  // -- Wheels --------------------------------------------------------------
  const wheelGeo = wheelGeometry(wheelRadius, wheelWidth)
  // A flat hub disc, not a sphere: a sphere bulges out of the tyre and reads
  // as an eyeball rather than a wheel.
  const hubGeo = discGeometry(wheelRadius * 0.54, wheelWidth * 1.06, 12)
  disposables.push(wheelGeo, hubGeo)

  const wheels: Mesh[] = []
  const steeredWheels: Object3D[] = []
  const axleX = length * 0.31
  // Tuck the wheels just inside the bodywork.
  const axleZ = bodyWidth / 2 - wheelWidth * 0.42

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

    // The hub is a child of the wheel so it spins with it.
    const hub = new Mesh(hubGeo, shared.rim)
    wheel.add(hub)

    wheels.push(wheel)
    if (steered) steeredWheels.push(pivot)
  }

  // -- Lights ---------------------------------------------------------------
  const lightGeo = roundedBoxGeometry(
    length * 0.028,
    lowerHeight * 0.24,
    bodyWidth * 0.19,
    lowerHeight * 0.08,
  )
  disposables.push(lightGeo)

  const headlights: Mesh[] = []
  for (const z of [-bodyWidth * 0.29, bodyWidth * 0.29]) {
    const light = new Mesh(lightGeo, shared.light)
    light.position.set(length * 0.487, lowerY + lowerHeight * 0.12, z)
    body.add(light)
    headlights.push(light)
  }

  const brakeLights: Mesh[] = []
  for (const z of [-bodyWidth * 0.29, bodyWidth * 0.29]) {
    const light = new Mesh(lightGeo, shared.brake)
    light.position.set(-length * 0.487, lowerY + lowerHeight * 0.12, z)
    body.add(light)
    brakeLights.push(light)
  }

  // -- Bumpers, grille, plates ---------------------------------------------
  // Thin bars rather than blocks: these are trim, and anything chunky here
  // swamps the silhouette.
  const bumperGeo = roundedBoxGeometry(
    length * 0.025,
    lowerHeight * 0.17,
    bodyWidth * 0.8,
    lowerHeight * 0.07,
  )
  disposables.push(bumperGeo)
  for (const sx of [length * 0.487, -length * 0.487]) {
    const bumper = new Mesh(bumperGeo, shared.trim)
    bumper.position.set(sx, clearance + lowerHeight * 0.26, 0)
    body.add(bumper)
  }

  const grilleGeo = roundedBoxGeometry(
    length * 0.015,
    lowerHeight * 0.15,
    bodyWidth * 0.42,
    lowerHeight * 0.05,
  )
  disposables.push(grilleGeo)
  const grille = new Mesh(grilleGeo, shared.chrome)
  grille.position.set(length * 0.492, lowerY - lowerHeight * 0.08, 0)
  body.add(grille)

  const plateGeo = roundedBoxGeometry(
    length * 0.012,
    lowerHeight * 0.12,
    bodyWidth * 0.26,
    0.008,
  )
  disposables.push(plateGeo)
  for (const sx of [length * 0.495, -length * 0.495]) {
    const plate = new Mesh(plateGeo, shared.plate)
    plate.position.set(sx, clearance + lowerHeight * 0.26, 0)
    body.add(plate)
  }

  // -- Wing mirrors ----------------------------------------------------------
  const mirrorGeo = roundedBoxGeometry(
    length * 0.018,
    cabinHeight * 0.16,
    bodyWidth * 0.06,
    0.012,
  )
  disposables.push(mirrorGeo)
  for (const side of [-1, 1]) {
    const mirror = new Mesh(mirrorGeo, shared.trim)
    mirror.position.set(
      cabinX + cabinLength * 0.44,
      cabinY - cabinHeight * 0.08,
      side * (cabinWidth / 2 + bodyWidth * 0.04),
    )
    body.add(mirror)
  }

  // -- Exhaust ----------------------------------------------------------------
  const exhaustGeo = discGeometry(wheelRadius * 0.2, length * 0.03, 8)
  disposables.push(exhaustGeo)
  const exhaust = new Mesh(exhaustGeo, shared.chrome)
  exhaust.rotation.y = Math.PI / 2
  exhaust.position.set(-length * 0.5, clearance * 0.95, bodyWidth * 0.24)
  body.add(exhaust)

  // -- Optional details --------------------------------------------------------
  if (art.hasSign) {
    const signGeo = roundedBoxGeometry(
      cabinLength * 0.26,
      cabinHeight * 0.26,
      cabinWidth * 0.34,
      0.025,
    )
    disposables.push(signGeo)
    const signMat = new MeshStandardMaterial({
      color: 0xffc93c,
      emissive: 0x996600,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    })
    disposables.push(signMat)
    const sign = new Mesh(signGeo, signMat)
    sign.position.set(cabinX, cabinY + cabinHeight * 0.56, 0)
    sign.castShadow = true
    body.add(sign)
  }

  if (art.hasStripe) {
    const stripeGeo = roundedBoxGeometry(
      length * 0.94,
      lowerHeight * 0.13,
      bodyWidth * 1.02,
      0.02,
    )
    disposables.push(stripeGeo)
    const stripe = new Mesh(stripeGeo, shared.trim)
    stripe.position.set(0, lowerY - lowerHeight * 0.2, 0)
    body.add(stripe)
  }

  // A soft contact shadow under the car. The sun's shadow map handles the
  // cast shadow; this fills the dark contact patch a low-res map cannot
  // resolve, and keeps the car anchored to the road on the low tier where
  // shadows are switched off entirely.
  const blobGeo = plateGeometry(length * 1.02, bodyWidth * 1.25, bodyWidth * 0.4)
  disposables.push(blobGeo)
  const blobMat = new MeshLambertMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  })
  disposables.push(blobMat)
  const blob = new Mesh(blobGeo, blobMat)
  blob.position.y = 0.015
  root.add(blob)

  return { root, body, wheels, steeredWheels, brakeLights, headlights, disposables }
}

/** Free everything a car owns. Shared materials are not touched. */
export function disposeCar(parts: CarParts): void {
  for (const d of parts.disposables) d.dispose()
  parts.disposables.length = 0
}
