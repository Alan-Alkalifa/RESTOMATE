"use client";

import "lenis/dist/lenis.css";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactLenis, useLenis } from "lenis/react";
import { useEffect } from "react";

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

export function SmoothScroll() {
  return (
    <ReactLenis root options={{ autoRaf: false }}>
      <GsapBridge />
    </ReactLenis>
  );
}
