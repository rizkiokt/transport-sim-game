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
  const disposables: Array<BufferGeometry | Material> = []

  // Children are shorter AND proportionally bigger-headed; varying both at
  // once is what makes a crowd read as a mix of ages rather than one model at
  // different scales.
  const childness = rng.next() < 0.32 ? rng.range(0.55, 0.85) : 1
  const H = CHARACTER_HEIGHT * rng.range(0.94, 1.06) * childness
  const headScale = 1 + (1 - childness) * 0.5

  const skin = rng.pick(SKIN_TONES)
  const top = rng.pick(TOP_COLORS)
  const trousers = rng.pick(TROUSER_COLORS)
  const hairColor = rng.pick(HAIR_COLORS)
  const shoeColor = rng.pick(SHOE_COLORS)
  const hairStyle = rng.pick(['short', 'bob', 'bun', 'cap', 'curly'] as const) as HairStyle

  const skinMat = new MeshStandardMaterial({ color: skin, roughness: 0.75, metalness: 0 })
  const topMat = new MeshStandardMaterial({ color: top, roughness: 0.82, metalness: 0 })
  const trouserMat = new MeshStandardMaterial({ color: trousers, roughness: 0.85, metalness: 0 })
  const hairMat = new MeshStandardMaterial({ color: hairColor, roughness: 0.7, metalness: 0 })
  const shoeMat = new MeshStandardMaterial({ color: shoeColor, roughness: 0.6, metalness: 0 })
  const eyeMat = new MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4, metalness: 0 })
  disposables.push(skinMat, topMat, trouserMat, hairMat, shoeMat, eyeMat)

  const root = new Group()
  const body = new Group()
  root.add(body)

  // -- Proportions ---------------------------------------------------------
  const legLength = H * 0.34
  const torsoHeight = H * 0.3
  const shoulderWidth = H * 0.26
  const waistWidth = shoulderWidth * 0.82
  const headRadius = H * 0.115 * headScale

  const hipY = legLength
  const torsoY = hipY + torsoHeight / 2
  const shoulderY = hipY + torsoHeight
  const headY = shoulderY + headRadius * 0.95

  // -- Legs ----------------------------------------------------------------
  // Two separate legs with a visible gap. A single column reads as a skittle.
  const legGeo = capsuleGeometry(H * 0.045, legLength * 0.62, 6)
  const shoeGeo = roundedBoxGeometry(H * 0.1, H * 0.038, H * 0.075, H * 0.018)
  disposables.push(legGeo, shoeGeo)

  const legs: Group[] = []
  for (const side of [-1, 1]) {
    const leg = new Group()
    leg.position.set(0, hipY, side * shoulderWidth * 0.24)
    body.add(leg)

    const legMesh = new Mesh(legGeo, trouserMat)
    legMesh.position.y = -legLength * 0.44
    legMesh.castShadow = true
    leg.add(legMesh)

    // Feet stop the figure looking like it is floating.
    const shoe = new Mesh(shoeGeo, shoeMat)
    shoe.position.set(H * 0.018, -legLength + H * 0.019, 0)
    shoe.castShadow = true
    leg.add(shoe)

    legs.push(leg)
  }

  // -- Torso ---------------------------------------------------------------
  // Tapered: shoulders wider than waist. This single cue does more for
  // "person" than any amount of detail elsewhere.
  const torsoGeo = roundedBoxGeometry(H * 0.13, torsoHeight, shoulderWidth, H * 0.055)
  disposables.push(torsoGeo)
  const torso = new Mesh(torsoGeo, topMat)
  torso.position.y = torsoY
  torso.castShadow = true
  body.add(torso)

  const hipGeo = roundedBoxGeometry(H * 0.12, torsoHeight * 0.3, waistWidth, H * 0.045)
  disposables.push(hipGeo)
  const hips = new Mesh(hipGeo, trouserMat)
  hips.position.y = hipY + torsoHeight * 0.12
  hips.castShadow = true
  body.add(hips)

  // -- Neck and head --------------------------------------------------------
  const neckGeo = capsuleGeometry(H * 0.028, H * 0.03, 6)
  disposables.push(neckGeo)
  const neck = new Mesh(neckGeo, skinMat)
  neck.position.y = shoulderY + H * 0.012
  body.add(neck)

  const headGeo = headGeometry(headRadius, 1.06, 16)
  disposables.push(headGeo)
  const head = new Mesh(headGeo, skinMat)
  head.position.y = headY
  head.castShadow = true
  body.add(head)

  // Eyes and mouth on the +X face; characters face +X, like the car. These
  // are deliberately oversized — at gameplay distance a realistically-scaled
  // eye is a single dark pixel, and a face with no readable features makes a
  // figure look eerie rather than friendly.
  const eyeGeo = headGeometry(headRadius * 0.19, 1, 10)
  disposables.push(eyeGeo)
  for (const side of [-1, 1]) {
    const eye = new Mesh(eyeGeo, eyeMat)
    eye.position.set(headRadius * 0.88, headY + headRadius * 0.12, side * headRadius * 0.36)
    eye.scale.x = 0.6
    body.add(eye)
  }

  const mouthGeo = roundedBoxGeometry(headRadius * 0.1, headRadius * 0.07, headRadius * 0.34, headRadius * 0.03)
  disposables.push(mouthGeo)
  const mouth = new Mesh(mouthGeo, eyeMat)
  mouth.position.set(headRadius * 0.9, headY - headRadius * 0.3, 0)
  body.add(mouth)

  // -- Hair ------------------------------------------------------------------
  const hairSeed = (i: number): number => ((i * 37) % 13) / 13
  switch (hairStyle) {
    case 'short': {
      const geo = headGeometry(headRadius * 1.05, 0.78, 14)
      disposables.push(geo)
      const hair = new Mesh(geo, hairMat)
      hair.position.y = headY + headRadius * 0.24
      hair.castShadow = true
      body.add(hair)
      break
    }
    case 'bob': {
      const geo = headGeometry(headRadius * 1.12, 1.0, 14)
      disposables.push(geo)
      const hair = new Mesh(geo, hairMat)
      hair.position.set(-headRadius * 0.1, headY + headRadius * 0.12, 0)
      hair.scale.y = 0.92
      hair.castShadow = true
      body.add(hair)
      // Carve the face back out with a skin-coloured front.
      const faceGeo = headGeometry(headRadius * 0.96, 1.02, 14)
      disposables.push(faceGeo)
      const face = new Mesh(faceGeo, skinMat)
      face.position.set(headRadius * 0.16, headY, 0)
      body.add(face)
      break
    }
    case 'bun': {
      const capGeo = headGeometry(headRadius * 1.05, 0.8, 14)
      disposables.push(capGeo)
      const cap = new Mesh(capGeo, hairMat)
      cap.position.y = headY + headRadius * 0.22
      body.add(cap)

      const bunGeo = blobGeometry(headRadius * 0.42, 1, 0.1, hairSeed)
      disposables.push(bunGeo)
      const bun = new Mesh(bunGeo, hairMat)
      bun.position.set(-headRadius * 0.75, headY + headRadius * 0.55, 0)
      bun.castShadow = true
      body.add(bun)
      break
    }
    case 'cap': {
      const crownGeo = headGeometry(headRadius * 1.07, 0.72, 14)
      disposables.push(crownGeo)
      const crown = new Mesh(crownGeo, hairMat)
      crown.position.y = headY + headRadius * 0.28
      crown.castShadow = true
      body.add(crown)

      const peakGeo = roundedBoxGeometry(
        headRadius * 0.9,
        headRadius * 0.12,
        headRadius * 1.4,
        headRadius * 0.05,
      )
      disposables.push(peakGeo)
      const peak = new Mesh(peakGeo, hairMat)
      peak.position.set(headRadius * 0.95, headY + headRadius * 0.3, 0)
      body.add(peak)
      break
    }
    case 'curly': {
      const curlGeo = blobGeometry(headRadius * 0.36, 0, 0.25, hairSeed)
      disposables.push(curlGeo)
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        const curl = new Mesh(curlGeo, hairMat)
        curl.position.set(
          Math.cos(a) * headRadius * 0.62 - headRadius * 0.1,
          headY + headRadius * 0.5,
          Math.sin(a) * headRadius * 0.62,
        )
        body.add(curl)
      }
      break
    }
  }

  // -- Arms --------------------------------------------------------------------
  // Held slightly away from the body so there is daylight between arm and
  // torso — without that gap the silhouette fuses into one blob.
  const armGeo = capsuleGeometry(H * 0.036, torsoHeight * 0.62, 6)
  const handGeo = headGeometry(H * 0.042, 1, 8)
  disposables.push(armGeo, handGeo)

  // The waving arm gets its own pivot at the shoulder.
  const arm = new Group()
  arm.position.set(0, shoulderY - H * 0.02, -shoulderWidth * 0.55)
  body.add(arm)

  const armMesh = new Mesh(armGeo, topMat)
  armMesh.position.y = -torsoHeight * 0.36
  armMesh.castShadow = true
  arm.add(armMesh)

  const hand = new Mesh(handGeo, skinMat)
  hand.position.y = -torsoHeight * 0.68
  arm.add(hand)

  // The resting arm.
  const stillArm = new Group()
  stillArm.position.set(0, shoulderY - H * 0.02, shoulderWidth * 0.55)
  stillArm.rotation.x = -0.14
  body.add(stillArm)

  const stillArmMesh = new Mesh(armGeo, topMat)
  stillArmMesh.position.y = -torsoHeight * 0.36
  stillArmMesh.castShadow = true
  stillArm.add(stillArmMesh)

  const stillHand = new Mesh(handGeo, skinMat)
  stillHand.position.y = -torsoHeight * 0.68
  stillArm.add(stillHand)

  return { root, body, arm, legs, disposables }
}

export function disposeCharacter(parts: CharacterParts): void {
  for (const d of parts.disposables) d.dispose()
  parts.disposables.length = 0
}
