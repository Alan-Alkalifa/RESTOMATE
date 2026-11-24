import type { ReactNode } from "react";
import { InviteChrome } from "./accept/_components/chrome";

/** The invitation pages share one small frame. The layout reads nothing per request. */
export default function InviteLayout({ children }: { children: ReactNode }) {
  return <InviteChrome>{children}</InviteChrome>;
}
