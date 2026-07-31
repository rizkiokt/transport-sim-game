import { describe, expect, it } from 'vitest'

import { createCharacter, disposeCharacter } from './character-model.js'

describe('createCharacter', () => {
  it('never throws across a wide range of seeds', () => {
    // Passenger seeds are derived from ride count and wall-clock time, so the
    // live game walks a large, effectively arbitrary seed space. A single seed
    // that throws stalls the ride loop forever, because the exception escapes
    // the spawn and the phase never advances.
    const failures: Array<{ seed: number; error: string }> = []

    for (let seed = 0; seed < 800; seed++) {
      try {
        const parts = createCharacter(seed)
        disposeCharacter(parts)
      } catch (error) {
        failures.push({ seed, error: error instanceof Error ? error.message : String(error) })
      }
    }

    expect(failures.slice(0, 5)).toEqual([])
  })

  it('never throws for the seeds the live game actually generates', () => {
    // Spawn seeds are `ridesCompleted * 7919 + floor(time * 1000)`, so they are
    // large and grow without bound. A throw here stalls the ride loop forever:
    // the exception escapes the spawn, the phase never advances past 'gap',
    // and no further passenger ever appears.
    const failures: Array<{ seed: number; error: string }> = []

    for (let rides = 0; rides < 12; rides++) {
      for (let ms = 0; ms < 60; ms++) {
        const seed = rides * 7919 + ms * 977
        try {
          disposeCharacter(createCharacter(seed))
        } catch (error) {
          failures.push({ seed, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    expect(failures.slice(0, 5)).toEqual([])
  })

  it('produces finite geometry', () => {
    // A non-positive derived radius yields NaN vertices rather than an error,
    // so the character silently renders as nothing. Sample rather than check
    // every vertex; the failure mode is whole-mesh, not one stray value.
    for (let seed = 0; seed < 60; seed++) {
      const parts = createCharacter(`small-${seed}`)
      parts.root.traverse((obj) => {
        const mesh = obj as { geometry?: { attributes?: { position?: { array: ArrayLike<number> } } } }
        const pos = mesh.geometry?.attributes?.position
        if (!pos) return
        for (let i = 0; i < pos.array.length; i += 7) {
          expect(Number.isFinite(pos.array[i])).toBe(true)
        }
      })
      disposeCharacter(parts)
    }
  })
})
