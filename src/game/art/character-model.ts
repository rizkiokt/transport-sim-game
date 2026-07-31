/**
 * Passenger characters.
 *
 * Built to be readable from the chase camera, which sees them from ten metres
 * away at a shallow angle. That distance rules out facial detail, so a person
 * has to be recognisable from **silhouette** alone: shoulders, separated arms,
 * two legs, feet on the ground, and a head that is clearly a head.
 *
 * An earlier version was a capsule with a ball on top, which at distance read
 * as a skittle rather than a person. The parts that fixed it were, in order of
 * impact: separating the legs so there is a gap you can see through, giving
 * the torso shoulders that are wider than its waist, and putting feet on it —
 * a figure without feet always looks like it is floating.
 *
 * Everything is generated from a seed, so a passenger looks the same whenever
 * they appear and the population reads as individuals rather than clones.
 */

import {
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from 'three'

import { createRng } from '../../engine/math/rng.js'
import {
  blobGeometry,
  capsuleGeometry,
  headGeometry,
  roundedBoxGeometry,
} from '../../engine/three/geometry.js'

const TOP_COLORS = [
  0xe84a4a, 0x3f8ee8, 0x43c465, 0xff8c42, 0xa06ae8, 0xff6fa5, 0x4ecbd4, 0xf5e04b, 0xf0f0f0,
]
const TROUSER_COLORS = [0x3a4a63, 0x2f3540, 0x6b5136, 0x4a5a4a, 0x5b3f5e, 0x35485c]
const SKIN_TONES = [0x8d5524, 0xa9713d, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac]
const HAIR_COLORS = [0x2b2b33, 0x4a3020, 0x7a5230, 0xc79a3f, 0xb4552f, 0x9c9c9c]
const SHOE_COLORS = [0xf0f0f0, 0xe84a4a, 0x2f3540, 0x8a5a2b, 0x3f8ee8]

export type HairStyle = 'short' | 'bob' | 'bun' | 'cap' | 'curly'

/**
 * Geometry and materials shared by every character.
 *
 * Characters used to build ~25 geometries each, every spawn. Measured at
 * ~2ms on a desktop, which is ~8ms on a tablet — half a frame budget, and a
 * visible hitch every time a passenger appeared.
 *
 * Every character is the same set of shapes; only overall height, head scale
 * and colours differ. So the shapes are built ONCE at a canonical height of
 * 1.0 and scaled per instance, and materials are interned by colour. Spawning
 * is then just creating Mesh objects, which is cheap.
 *
 * The trade-off is ownership: these outlive any single character, so
 * `disposeCharacter` must not free them. `disposeCharacterAssets` does, for
 * teardown.
 */
interface CharacterAssets {
  leg: BufferGeometry
  shoe: BufferGeometry
  torso: BufferGeometry
  hips: BufferGeometry
  neck: BufferGeometry
  head: BufferGeometry
  eye: BufferGeometry
  mouth: BufferGeometry
  collar: BufferGeometry
  sleeve: BufferGeometry
  forearm: BufferGeometry
  hand: BufferGeometry
  hairShort: BufferGeometry
  hairBob: BufferGeometry
  hairFace: BufferGeometry
  hairCap: BufferGeometry
  hairBun: BufferGeometry
  hairCrown: BufferGeometry
  hairPeak: BufferGeometry
  hairCurl: BufferGeometry
}

/** Canonical height everything is authored at; instances scale from this. */
const BASE_H = 1

let assets: CharacterAssets | null = null
const materialCache = new Map<string, MeshStandardMaterial>()

function getAssets(): CharacterAssets {
  if (assets) return assets

  const H = BASE_H
  const legLength = H * 0.34
  const torsoHeight = H * 0.3
  const shoulderWidth = H * 0.26
  const headRadius = H * 0.115
  const hairSeed = (i: number): number => ((i * 37) % 13) / 13

  assets = {
    leg: capsuleGeometry(H * 0.045, legLength * 0.62, 6),
    shoe: roundedBoxGeometry(H * 0.1, H * 0.038, H * 0.075, H * 0.018),
    torso: roundedBoxGeometry(H * 0.13, torsoHeight, shoulderWidth, H * 0.055),
    hips: roundedBoxGeometry(H * 0.12, torsoHeight * 0.3, shoulderWidth * 0.82, H * 0.045),
    neck: capsuleGeometry(H * 0.028, H * 0.03, 6),
    head: headGeometry(headRadius, 1.06, 16),
    eye: headGeometry(headRadius * 0.19, 1, 10),
    mouth: roundedBoxGeometry(headRadius * 0.1, headRadius * 0.07, headRadius * 0.34, headRadius * 0.03),
    collar: roundedBoxGeometry(H * 0.135, H * 0.03, shoulderWidth * 1.02, H * 0.014),
    sleeve: capsuleGeometry(H * 0.038, torsoHeight * 0.26, 6),
    forearm: capsuleGeometry(H * 0.032, torsoHeight * 0.28, 6),
    hand: headGeometry(H * 0.042, 1, 8),
    hairShort: headGeometry(headRadius * 1.05, 0.78, 14),
    hairBob: headGeometry(headRadius * 1.12, 1.0, 14),
    hairFace: headGeometry(headRadius * 0.96, 1.02, 14),
    hairCap: headGeometry(headRadius * 1.05, 0.8, 14),
    hairBun: blobGeometry(headRadius * 0.42, 1, 0.1, hairSeed),
    hairCrown: headGeometry(headRadius * 1.07, 0.72, 14),
    hairPeak: roundedBoxGeometry(headRadius * 0.9, headRadius * 0.12, headRadius * 1.4, headRadius * 0.05),
    hairCurl: blobGeometry(headRadius * 0.36, 0, 0.25, hairSeed),
  }
  return assets
}

/** Materials are interned by colour: the palettes are small and fixed. */
function getMaterial(color: number, roughness: number): MeshStandardMaterial {
  const key = `${color}:${roughness}`
  let mat = materialCache.get(key)
  if (!mat) {
    mat = new MeshStandardMaterial({ color, roughness, metalness: 0 })
    materialCache.set(key, mat)
  }
  return mat
}

/** Free the shared pool. Only for full teardown, never per character. */
export function disposeCharacterAssets(): void {
  if (assets) {
    for (const geo of Object.values(assets)) geo.dispose()
    assets = null
  }
  for (const mat of materialCache.values()) mat.dispose()
  materialCache.clear()
}

export interface CharacterParts {
  root: Group
  /** Bobs and hops without moving the shadow. */
  body: Group
  /** Waves at an approaching car. */
  arm: Group
  /** Swing these when walking, later. */
  legs: Group[]
  disposables: Array<BufferGeometry | Material>
}

/** Overall height in world units. Roughly shoulder-high beside the taxi. */
export const CHARACTER_HEIGHT = 1.15

export function createCharacter(seed: number | string): CharacterParts {
  const rng = createRng(`character3d:${seed}`)
  const g = getAssets()

  // Children are shorter AND proportionally bigger-headed; varying both at
  // once is what makes a crowd read as a mix of ages rather than one model at
  // different scales.
  const childness = rng.next() < 0.32 ? rng.range(0.55, 0.85) : 1
  const heightScale = CHARACTER_HEIGHT * rng.range(0.94, 1.06) * childness
  const headScale = 1 + (1 - childness) * 0.5

  const skinMat = getMaterial(rng.pick(SKIN_TONES), 0.75)
  const topMat = getMaterial(rng.pick(TOP_COLORS), 0.82)
  const trouserMat = getMaterial(rng.pick(TROUSER_COLORS), 0.85)
  const hairMat = getMaterial(rng.pick(HAIR_COLORS), 0.7)
  const shoeMat = getMaterial(rng.pick(SHOE_COLORS), 0.6)
  const eyeMat = getMaterial(0x1a1a22, 0.4)
  const hairStyle = rng.pick(['short', 'bob', 'bun', 'cap', 'curly'] as const) as HairStyle

  const root = new Group()
  // Everything is authored at BASE_H and scaled here, so the geometry can be
  // shared across every character regardless of their height.
  root.scale.setScalar(heightScale)

  const body = new Group()
  root.add(body)

  // -- Proportions, at the canonical height ---------------------------------
  const H = BASE_H
  const legLength = H * 0.34
  const torsoHeight = H * 0.3
  const shoulderWidth = H * 0.26
  const headRadius = H * 0.115

  const hipY = legLength
  const torsoY = hipY + torsoHeight / 2
  const shoulderY = hipY + torsoHeight
  // The head group is scaled separately, so its offset has to account for that.
  const headY = shoulderY + headRadius * 0.95 * headScale

  // -- Legs ------------------------------------------------------------------
  // Two separate legs with a visible gap. A single column reads as a skittle.
  const legs: Group[] = []
  for (const side of [-1, 1]) {
    const leg = new Group()
    leg.position.set(0, hipY, side * shoulderWidth * 0.24)
    body.add(leg)

    const legMesh = new Mesh(g.leg, trouserMat)
    legMesh.position.y = -legLength * 0.44
    legMesh.castShadow = true
    leg.add(legMesh)

    // Feet stop the figure looking like it is floating.
    const shoe = new Mesh(g.shoe, shoeMat)
    shoe.position.set(H * 0.018, -legLength + H * 0.019, 0)
    shoe.castShadow = true
    leg.add(shoe)

    legs.push(leg)
  }

  // -- Torso -------------------------------------------------------------------
  // Tapered: shoulders wider than waist. This single cue does more for
  // "person" than any amount of detail elsewhere.
  const torso = new Mesh(g.torso, topMat)
  torso.position.y = torsoY
  torso.castShadow = true
  body.add(torso)

  const hips = new Mesh(g.hips, trouserMat)
  hips.position.y = hipY + torsoHeight * 0.12
  hips.castShadow = true
  body.add(hips)

  const collar = new Mesh(g.collar, topMat)
  collar.position.y = shoulderY - H * 0.012
  body.add(collar)

  const neck = new Mesh(g.neck, skinMat)
  neck.position.y = shoulderY + H * 0.012
  body.add(neck)

  // -- Head ---------------------------------------------------------------------
  // Its own group so head scale can vary without needing separate geometry.
  const headGroup = new Group()
  headGroup.position.y = headY
  headGroup.scale.setScalar(headScale)
  body.add(headGroup)

  const head = new Mesh(g.head, skinMat)
  head.castShadow = true
  headGroup.add(head)

  // Eyes and mouth on the +X face; characters face +X, like the car. These
  // are deliberately oversized — at gameplay distance a realistically-scaled
  // eye is a single dark pixel, and a face with no readable features makes a
  // figure look eerie rather than friendly.
  for (const side of [-1, 1]) {
    const eye = new Mesh(g.eye, eyeMat)
    eye.position.set(headRadius * 0.88, headRadius * 0.12, side * headRadius * 0.36)
    eye.scale.x = 0.6
    headGroup.add(eye)
  }

  const mouth = new Mesh(g.mouth, eyeMat)
  mouth.position.set(headRadius * 0.9, -headRadius * 0.3, 0)
  headGroup.add(mouth)

  // -- Hair ------------------------------------------------------------------------
  switch (hairStyle) {
    case 'short': {
      const hair = new Mesh(g.hairShort, hairMat)
      hair.position.y = headRadius * 0.24
      hair.castShadow = true
      headGroup.add(hair)
      break
    }
    case 'bob': {
      const hair = new Mesh(g.hairBob, hairMat)
      hair.position.set(-headRadius * 0.1, headRadius * 0.12, 0)
      hair.scale.y = 0.92
      hair.castShadow = true
      headGroup.add(hair)
      // Carve the face back out with a skin-coloured front.
      const face = new Mesh(g.hairFace, skinMat)
      face.position.set(headRadius * 0.16, 0, 0)
      headGroup.add(face)
      break
    }
    case 'bun': {
      const cap = new Mesh(g.hairCap, hairMat)
      cap.position.y = headRadius * 0.22
      headGroup.add(cap)

      const bun = new Mesh(g.hairBun, hairMat)
      bun.position.set(-headRadius * 0.75, headRadius * 0.55, 0)
      bun.castShadow = true
      headGroup.add(bun)
      break
    }
    case 'cap': {
      const crown = new Mesh(g.hairCrown, hairMat)
      crown.position.y = headRadius * 0.28
      crown.castShadow = true
      headGroup.add(crown)

      const peak = new Mesh(g.hairPeak, hairMat)
      peak.position.set(headRadius * 0.95, headRadius * 0.3, 0)
      headGroup.add(peak)
      break
    }
    case 'curly': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        const curl = new Mesh(g.hairCurl, hairMat)
        curl.position.set(
          Math.cos(a) * headRadius * 0.62 - headRadius * 0.1,
          headRadius * 0.5,
          Math.sin(a) * headRadius * 0.62,
        )
        headGroup.add(curl)
      }
      break
    }
  }

  // -- Arms ----------------------------------------------------------------------------
  // Held slightly away from the body so there is daylight between arm and
  // torso — without that gap the silhouette fuses into one blob. Upper arm in
  // the shirt colour, forearm in skin, so the figure reads as dressed.
  const buildArm = (z: number, rotX: number): Group => {
    const arm = new Group()
    arm.position.set(0, shoulderY - H * 0.02, z)
    arm.rotation.x = rotX
    body.add(arm)

    const sleeve = new Mesh(g.sleeve, topMat)
    sleeve.position.y = -torsoHeight * 0.2
    sleeve.castShadow = true
    arm.add(sleeve)

    const forearm = new Mesh(g.forearm, skinMat)
    forearm.position.y = -torsoHeight * 0.5
    forearm.castShadow = true
    arm.add(forearm)

    const hand = new Mesh(g.hand, skinMat)
    hand.position.y = -torsoHeight * 0.68
    arm.add(hand)

    return arm
  }

  const arm = buildArm(-shoulderWidth * 0.55, 0)
  buildArm(shoulderWidth * 0.55, -0.14)

  // Nothing is owned per character any more — geometry and materials are
  // shared and outlive every instance.
  return { root, body, arm, legs, disposables: [] }
}

/**
 * Release a character.
 *
 * Deliberately does NOT dispose geometry or materials: those are shared by
 * every character and owned by the module (see {@link disposeCharacterAssets}).
 * Freeing them here would destroy the buffers the next passenger needs.
 */
export function disposeCharacter(parts: CharacterParts): void {
  parts.root.clear()
  parts.disposables.length = 0
}
