/**
 * Motion tokens (DESIGN.md §4.5, §4.5.2). The one place durations and easings live for Motion code.
 * They mirror `--duration-*` and `--ease-*` in globals.css. Animate only `transform` and `opacity`.
 */

/** Seconds (Motion's unit): hovers and presses, menus and modals, sheets and toasts. */
export const duration = { fast: 0.15, base: 0.2, slow: 0.25 } as const;

/** Entering is ease-out, leaving is ease-in (same curves as `--ease-enter` and `--ease-leave`). */
export const ease = {
  out: [0, 0, 0.2, 1],
  in: [0.4, 0, 1, 1],
} as const;

/** `scale(0.98)` while pressed (§4.5). */
export const PRESS_SCALE = 0.98;

/** How far an entering element travels, in px. With reduced motion Motion drops it and the fade stays. */
export const DISTANCE = 8;
/** A sheet travels a little further than a toast. */
export const SHEET_DISTANCE = 32;

export const transition = {
  press: { duration: duration.fast, ease: ease.out },
  enter: { duration: duration.base, ease: ease.out },
  enterSlow: { duration: duration.slow, ease: ease.out },
  leave: { duration: duration.base, ease: ease.in },
} as const;
