import type { ReactNode } from "react";
import { OnboardingChrome } from "./_components/chrome";

/** Signed-in setup pages share one frame. The layout itself reads nothing per request. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <OnboardingChrome>{children}</OnboardingChrome>;
}
