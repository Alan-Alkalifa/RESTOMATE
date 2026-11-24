import type { ReactNode } from "react";
import { AuthChrome } from "./_components/auth-chrome";

/** Signup, login and password pages share one frame. The layout itself reads nothing per request. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthChrome>{children}</AuthChrome>;
}
