"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

/**
 * Offline and reconnecting (DESIGN.md §6.8): a sticky warning-soft bar at the top of POS, KDS and the live
 * board. It turns success-soft "Back online" for 3 seconds, then hides. Connection state is always
 * visible there. Both messages come from the caller's translations.
 */

function subscribe(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/** `navigator.onLine`, live. It is `true` on the server, so the first render shows nothing. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export const BACK_ONLINE_MS = 3000;

export function OfflineBar({
  offlineMessage,
  backOnlineMessage,
  online,
  className,
}: {
  offlineMessage: ReactNode;
  backOnlineMessage: ReactNode;
  /** For tests and stories. By default the bar follows the browser. */
  online?: boolean;
  className?: string;
}) {
  const browserOnline = useOnlineStatus();
  const isOnline = online ?? browserOnline;
  const [wasOffline, setWasOffline] = useState(!isOnline);
  const [prevOnline, setPrevOnline] = useState(isOnline);

  // Went offline: remember it (adjusted during render, not in an effect).
  if (prevOnline !== isOnline) {
    setPrevOnline(isOnline);
    if (!isOnline) setWasOffline(true);
  }

  // Back online after being offline: show "Back online" for 3 seconds, then hide.
  useEffect(() => {
    if (!isOnline || !wasOffline) return;
    const timer = setTimeout(() => setWasOffline(false), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [isOnline, wasOffline]);

  if (isOnline && !wasOffline) return null;
  const offline = !isOnline;

  return (
    <div
      role="status"
      className={cn(
        "sticky top-0 z-40 flex min-h-touch items-center gap-2 px-page py-2 text-body-sm font-medium md:px-page-md",
        offline ? "bg-warning-50 text-warning-700" : "bg-success-50 text-success-700",
        className,
      )}
    >
      <Icon name={offline ? "wifiOff" : "check"} size={20} className="shrink-0" />
      <span>{offline ? offlineMessage : backOnlineMessage}</span>
    </div>
  );
}
