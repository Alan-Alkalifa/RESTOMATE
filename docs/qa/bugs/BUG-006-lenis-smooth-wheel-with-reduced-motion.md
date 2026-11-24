# BUG-006: The marketing page still smooth-scrolls the wheel with prefers-reduced-motion

| | |
|---|---|
| Task ID | MF-T34 (M0-FE-09 Public and platform shells, #65: `app/(marketing)/_components/smooth-scroll.tsx`) |
| PR / commit | stack top `d09f495` |
| Severity | S3: DESIGN 4.5 and 4.5.2 make reduced motion mandatory ("the marketing page has no smooth scroll"); the page is public and short, nothing is lost, but it is the one place a reduced-motion visitor is still moved |
| Owner (PLAN 1.1) | REYKI |
| Found by / date | DAVIN / 2026-11-24, `e2e/reduced-motion.e2e.ts` |
| Environment | local `next dev`, Chromium with `reducedMotion: "reduce"`, lenis as installed in `apps/web/node_modules` |

## Steps
1. Emulate `prefers-reduced-motion: reduce`, open `/`.
2. Dispatch a wheel event: `document.body.dispatchEvent(new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true }))` and read `event.defaultPrevented`.
3. Repeat with `reducedMotion: "no-preference"` as the control.

## Expected
With reduced motion Lenis leaves the wheel alone (`defaultPrevented` is false) and the browser scrolls natively, as DESIGN 4.5.3 says ("Lenis keeps its default `respectReducedMotion: true`").

## Actual
`defaultPrevented` is `true` in both runs: Lenis takes over the wheel and eases the scroll even with reduced motion on. The control passes (`true`), so the check can tell.

Why (read from the installed `lenis/dist/lenis.mjs`): `respectReducedMotion` is read in one place, `scrollTo`, where it only makes a programmatic scroll immediate (`if (this.prefersReducedMotion) if (programmatic) immediate = true`). The wheel path (`onVirtualScroll`) never checks it: it cancels the event and calls `scrollTo(target, { programmatic: false, lerp: 0.1 })`, which is still eased. So the default option does not do what DESIGN assumes.

## Evidence
`e2e/reduced-motion.e2e.ts`: `reduced motion on > marketing page` fails with "Lenis is smoothing the wheel scroll"; `reduced motion off (control) > the marketing page smooth-scrolls when motion is allowed` passes. In the same file the modal, sheet and toast pass (no interpolated movement under reduced motion; the modal control moves).
Not observed directly: the easing itself. In headless Chromium a wheel notch moved the page from 0 to its small maximum in one sampled step, with motion allowed as well, so the takeover (and the library source) is the evidence, not a frame-by-frame scroll trace.

## Suggested direction (REYKI decides)
Do not mount smooth scroll when `(prefers-reduced-motion: reduce)` matches, or pass `smoothWheel: false` to `ReactLenis` in that case (and follow changes of the media query).

## Retest (filled after the fix)
| Date | Commit | Result | Regression run on |
|---|---|---|---|
