/**
 * The game's name and identity, defined once.
 *
 * The document title, the title screen, and anything else that displays the
 * name all read from here, so renaming is a one-line change rather than a
 * grep-and-hope across the codebase.
 */

export const BRANDING = {
  /** Full name, used on the title screen and in the document title. */
  title: 'Transport Simulator',

  /**
   * Short form for tight spaces (a narrow portrait HUD, a paused overlay).
   * Falls back gracefully where the full name would not fit.
   */
  shortTitle: 'Transport Sim',

  /** One line a parent would read in a store listing or link preview. */
  tagline: 'Drive your own transport company. Pick up passengers, earn coins, and grow your fleet.',
} as const
