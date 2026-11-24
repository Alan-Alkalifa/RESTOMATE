"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";

/**
 * Loads Motion's animation features once (`m` components + `domAnimation`) and follows the visitor's
 * reduced-motion setting: transforms are dropped, opacity fades stay (DESIGN.md §4.5.2).
 * Mount it once near the root. It takes server-rendered `children`, so the layout stays a server component.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
