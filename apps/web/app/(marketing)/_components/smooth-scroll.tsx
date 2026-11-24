"use client";

import "lenis/dist/lenis.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactLenis, useLenis } from "lenis/react";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Lenis smooth scroll driven by GSAP's ticker, so `ScrollTrigger` and the scroll stay in sync
 * (DESIGN.md §4.5.3). Lenis' own loop is off (`autoRaf: false`); the ticker callback is removed on
 * unmount. `syncTouch` stays off, so phones and tablets scroll natively. Lenis and GSAP are imported
 * here and in the other files of this route group only, never from `components/ui`.
 */
function GsapBridge() {
  const lenis = useLenis();
  useEffect(() => {
    if (!lenis) return;
    gsap.registerPlugin(ScrollTrigger);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    lenis.on("scroll", ScrollTrigger.update);
    return () => {
      gsap.ticker.remove(tick);
      lenis.off("scroll", ScrollTrigger.update);
    };
  }, [lenis]);
  return null;
}

const MOTION_ALLOWED = "(prefers-reduced-motion: no-preference)";

function subscribe(notify: () => void) {
  const query = window.matchMedia(MOTION_ALLOWED);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

/**
 * Whether smooth scroll may run. It follows the setting while the page is open. The server (and the
 * first client render, which must match it) assume yes; nothing here renders markup, so the HTML is
 * the same either way and the choice is made on the client right after hydration.
 */
function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOTION_ALLOWED).matches,
    () => true,
  );
}

/**
 * With reduced motion neither Lenis nor the GSAP ticker hookup is mounted at all, so the browser
 * scrolls natively (DESIGN.md §4.5.2). Lenis' own `respectReducedMotion` only covers scrolls started
 * by code, not the wheel, so it can't be relied on (BUG-006). Unmounting destroys Lenis and removes
 * the ticker callback, so switching the setting on or off while the page is open takes effect at once.
 */
export function SmoothScroll() {
  if (!useMotionAllowed()) return null;
  return (
    <ReactLenis root options={{ autoRaf: false }}>
      <GsapBridge />
    </ReactLenis>
  );
}
