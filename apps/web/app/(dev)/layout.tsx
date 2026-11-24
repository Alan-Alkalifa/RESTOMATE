import type { ReactNode } from "react";
import { MotionProvider } from "@/components/motion/provider";

/** The review pages follow the visitor's reduced-motion setting like every other surface (§4.5.2). */
export default function DevLayout({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}</MotionProvider>;
}
