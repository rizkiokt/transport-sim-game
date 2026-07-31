/**
 * Passenger characters in 3D.
 *
 * Built to be readable from the chase camera, which sees them from ~15m away
 * at a shallow angle: big head, strong silhouette, saturated clothing. Fine
 * facial detail would be invisible, so personality comes from proportion,
 * colour and hair shape instead.
 *
 * Every character is generated from a seed so a given passenger looks the
 * same every time they appear, and so the population feels like individuals
 * rather than clones.
 */

import {
  Group,
  Mesh,
  MeshLambertMaterial,
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

/** Kid-appealing, colour-blind-distinguishable clothing colours. */
const OUTFIT_COLORS = [
  0xe84a4a, 0x3f8ee8, 0x43c465, 0xff8c42, 0xa06ae8, 0xff6fa5, 0x4ecbd4, 0xf5e04b,
]
const SKIN_TONES = [0x8d5524, 0xa9713d, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac]
const HAIR_COLORS = [0x2b2b33, 0x5b3a1e, 0x8a5a2b, 0xd9a441, 0xc94f2f, 0x9c9c9c]

export type HairStyle = 'bald' | 'round' | 'spiky' | 'buns' | 'cap'

export interface CharacterParts {
  root: Group
  /** Bobs and hops without moving the shadow. */
  body: Group
  /** Waves at an approaching car. */
  arm: Group
  disposables: Array<BufferGeometry | Material>
}

/** Overall height in world units. Roughly waist-high next to the taxi. */
export const CHARACTER_HEIGHT = 1.05

export function createCharacter(seed: number | string): CharacterParts {
  const rng = createRng(`character3d:${seed}`)
  const disposables: Array<BufferGeometry | Material> = []

  const scale = rng.range(0.82, 1.1)
  const skin = rng.pick(SKIN_TONES)
  const outfit = rng.pick(OUTFIT_COLORS)
  const hairColor = rng.pick(HAIR_COLORS)
  const hairStyle = rng.pick(['bald', 'round', 'spiky', 'buns', 'cap'] as const) as HairStyle

  const skinMat = new MeshLambertMaterial({ color: skin })
  const outfitMat = new MeshLambertMaterial({ color: outfit })
  const hairMat = new MeshLambertMaterial({ color: hairColor })
  const eyeMat = new MeshLambertMaterial({ color: 0x1c2a45 })
  disposables.push(skinMat, outfitMat, hairMat, eyeMat)

  const root = new Group()
  const body = new Group()
  root.add(body)

  const H = CHARACTER_HEIGHT * scale
  const bodyRadius = H * 0.19
  const bodyLength = H * 0.34
  const headRadius = H * 0.21

  // -- Torso -------------------------------------------------------------
  const torsoGeo = capsuleGeometry(bodyRadius, bodyLength, 8)
  disposables.push(torsoGeo)
  const torso = new Mesh(torsoGeo, outfitMat)
  torso.position.y = bodyRadius + bodyLength / 2
  torso.castShadow = true
  body.add(torso)

  // -- Legs --------------------------------------------------------------
  const legGeo = capsuleGeometry(H * 0.055, H * 0.12, 6)
  disposables.push(legGeo)
  const legMat = new MeshLambertMaterial({ color: 0x3a3f4b })
  disposables.push(legMat)
  for (const x of [-bodyRadius * 0.45, bodyRadius * 0.45]) {
    const leg = new Mesh(legGeo, legMat)
    leg.position.set(x, H * 0.115, 0)
    leg.castShadow = true
    body.add(leg)
  }

  // -- Head --------------------------------------------------------------
  const headGeo = headGeometry(headRadius, 0.94, 14)
  disposables.push(headGeo)
  const head = new Mesh(headGeo, skinMat)
  head.position.y = torso.position.y + bodyLength / 2 + headRadius * 0.82
  head.castShadow = true
  body.add(head)

  // Eyes: two dark spheres on the +X face (characters face +X, like the car).
  const eyeGeo = headGeometry(headRadius * 0.15, 1, 8)
  disposables.push(eyeGeo)
  for (const z of [-headRadius * 0.36, headRadius * 0.36]) {
    const eye = new Mesh(eyeGeo, eyeMat)
    eye.position.set(headRadius * 0.82, head.position.y + headRadius * 0.08, z)
    body.add(eye)
  }

  // -- Hair --------------------------------------------------------------
  switch (hairStyle) {
    case 'bald':
      break
    case 'round': {
      const geo = blobGeometry(headRadius * 1.04, 1, 0.06, (i) => rng.next() * 0 + ((i * 37) % 11) / 11)
      disposables.push(geo)
      const hair = new Mesh(geo, hairMat)
      hair.position.y = head.position.y + headRadius * 0.28
      hair.scale.y = 0.62
      hair.castShadow = true
      body.add(hair)
      break
    }
    case 'spiky': {
      const geo = capsuleGeometry(headRadius * 0.12, headRadius * 0.42, 5)
      disposables.push(geo)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const spike = new Mesh(geo, hairMat)
        spike.position.set(
          Math.cos(a) * headRadius * 0.5,
          head.position.y + headRadius * 0.82,
          Math.sin(a) * headRadius * 0.5,
        )
        spike.rotation.z = Math.cos(a) * -0.5
        spike.rotation.x = Math.sin(a) * 0.5
        body.add(spike)
      }
      break
    }
    case 'buns': {
      const capGeo = blobGeometry(headRadius * 1.02, 1, 0.05, (i) => ((i * 29) % 13) / 13)
      disposables.push(capGeo)
      const cap = new Mesh(capGeo, hairMat)
      cap.position.y = head.position.y + headRadius * 0.3
      cap.scale.y = 0.6
      body.add(cap)

      const bunGeo = headGeometry(headRadius * 0.38, 1, 8)
      disposables.push(bunGeo)
      for (const z of [-headRadius, headRadius]) {
        const bun = new Mesh(bunGeo, hairMat)
        bun.position.set(-headRadius * 0.1, head.position.y + headRadius * 0.55, z)
        bun.castShadow = true
        body.add(bun)
      }
      break
    }
    case 'cap': {
      const crownGeo = headGeometry(headRadius * 1.03, 0.6, 12)
      disposables.push(crownGeo)
      const crown = new Mesh(crownGeo, hairMat)
      crown.position.y = head.position.y + headRadius * 0.36
      crown.castShadow = true
      body.add(crown)

      const peakGeo = roundedBoxGeometry(headRadius * 0.85, headRadius * 0.12, headRadius * 1.3, headRadius * 0.05)
      disposables.push(peakGeo)
      const peak = new Mesh(peakGeo, hairMat)
      peak.position.set(headRadius * 0.85, head.position.y + headRadius * 0.3, 0)
      body.add(peak)
      break
    }
  }

  // -- Waving arm ---------------------------------------------------------
  // A pivot at the shoulder so the whole arm swings from the right place.
  const arm = new Group()
  arm.position.set(0, torso.position.y + bodyLength * 0.34, -bodyRadius * 0.95)
  body.add(arm)

  const armGeo = capsuleGeometry(H * 0.045, H * 0.16, 6)
  disposables.push(armGeo)
  const armMesh = new Mesh(armGeo, outfitMat)
  armMesh.position.y = -H * 0.09
  armMesh.castShadow = true
  arm.add(armMesh)

  const handGeo = headGeometry(H * 0.055, 1, 8)
  disposables.push(handGeo)
  const hand = new Mesh(handGeo, skinMat)
  hand.position.y = -H * 0.19
  arm.add(hand)

  // The still arm on the other side.
  const stillArm = new Mesh(armGeo, outfitMat)
  stillArm.position.set(0, torso.position.y + bodyLength * 0.24, bodyRadius * 0.95)
  stillArm.rotation.x = -0.12
  stillArm.castShadow = true
  body.add(stillArm)

  return { root, body, arm, disposables }
}

export function disposeCharacter(parts: CharacterParts): void {
  for (const d of parts.disposables) d.dispose()
  parts.disposables.length = 0
}
