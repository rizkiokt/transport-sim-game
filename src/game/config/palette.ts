/**
 * The game's colour vocabulary.
 *
 * Every colour the game draws comes from here. Centralising them is what
 * makes the future day/night grade possible (one pass over one table), and it
 * keeps the world reading as one deliberate art style instead of a pile of
 * hex codes scattered through draw calls.
 *
 * Chosen for a 6-year-old audience: saturated but not neon, high contrast
 * between things that matter (roads vs grass, passengers vs ground), and
 * warm rather than gritty.
 */

import { fromHex, type Rgba } from '../../engine/render/color.js'

export const PALETTE = {
  // -- Ground ------------------------------------------------------------
  grass: fromHex('#63a24f'),
  grassPark: fromHex('#6fb05a'),
  sidewalk: fromHex('#cfc7b8'),
  road: fromHex('#4a4e5a'),
  roadDash: fromHex('#f2f2f2'),
  crosswalk: fromHex('#e8e8e8'),

  // -- Nature ------------------------------------------------------------
  treeFoliage: fromHex('#3d7c3f'),
  treeFoliageLight: fromHex('#529a54'),
  treeTrunk: fromHex('#7a5230'),
  pond: fromHex('#5aa7d6'),

  // -- Building families (varied per-instance with vary()) ---------------
  buildingBrick: fromHex('#c9705a'),
  buildingCream: fromHex('#e5d3ac'),
  buildingTeal: fromHex('#7fb8a4'),
  buildingBlue: fromHex('#8fa3bf'),
  buildingCoral: fromHex('#e2907a'),
  roofWarm: fromHex('#b0563f'),
  roofCool: fromHex('#6d7f96'),
  roofPale: fromHex('#cbbfa4'),

  // -- Vehicle & characters ----------------------------------------------
  tyre: fromHex('#2b2b33'),
  glass: fromHex('#aadcf0'),
  glassEdge: fromHex('#7fb8d9'),
  headlight: fromHex('#fff6c9'),
  taillight: fromHex('#ff5a5a'),
  shadow: fromHex('#00000030'),

  // -- UI ----------------------------------------------------------------
  uiPanel: fromHex('#1f2c47e6'),
  uiPanelLight: fromHex('#ffffffe8'),
  uiInk: fromHex('#1c2a45'),
  uiInkLight: fromHex('#ffffff'),
  coinGold: fromHex('#ffc93c'),
  coinGoldDark: fromHex('#e0a800'),
  success: fromHex('#43c465'),
  attention: fromHex('#ff8c42'),
} as const satisfies Record<string, Rgba>

/**
 * Paint colours a child can pick for vehicles. Names are for code only —
 * the UI shows swatches, never words.
 */
export const VEHICLE_PAINTS: readonly Rgba[] = [
  fromHex('#ffc93c'), // taxi yellow
  fromHex('#e84a4a'), // fire red
  fromHex('#3f8ee8'), // bright blue
  fromHex('#43c465'), // green
  fromHex('#ff8c42'), // orange
  fromHex('#a06ae8'), // purple
  fromHex('#ff6fa5'), // pink
  fromHex('#4ecbd4'), // aqua
]

/**
 * Colours used for destination symbols. Deliberately far apart in hue AND
 * pairs with distinct shapes, so colour-blind players still match on shape.
 */
export const SYMBOL_COLORS: readonly Rgba[] = [
  fromHex('#e84a4a'), // red
  fromHex('#3f8ee8'), // blue
  fromHex('#ffc93c'), // yellow
  fromHex('#43c465'), // green
  fromHex('#a06ae8'), // purple
]

/** Skin tones for the passenger generator — an inclusive, cartoon-warm range. */
export const SKIN_TONES: readonly Rgba[] = [
  fromHex('#8d5524'),
  fromHex('#a9713d'),
  fromHex('#c68642'),
  fromHex('#e0ac69'),
  fromHex('#f1c27d'),
  fromHex('#ffdbac'),
]

/** Clothing colours for passengers. */
export const CLOTHING_COLORS: readonly Rgba[] = [
  fromHex('#e84a4a'),
  fromHex('#3f8ee8'),
  fromHex('#43c465'),
  fromHex('#ff8c42'),
  fromHex('#a06ae8'),
  fromHex('#ff6fa5'),
  fromHex('#4ecbd4'),
  fromHex('#f5e04b'),
  fromHex('#8fa3bf'),
]

/** Hair colours. */
export const HAIR_COLORS: readonly Rgba[] = [
  fromHex('#2b2b33'),
  fromHex('#5b3a1e'),
  fromHex('#8a5a2b'),
  fromHex('#d9a441'),
  fromHex('#c94f2f'),
  fromHex('#9c9c9c'),
]
