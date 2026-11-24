"use client";

import { useSyncExternalStore } from "react";
import { SHEET_DISTANCE } from "../motion/tokens";
import { DialogShell, type DialogShellProps } from "./dialog-shell";

/**
 * Sheet (DESIGN.md §6.7): slides in from the right on desktop and from the bottom on phones. Used for
 * editing records and for item modifiers on POS. Same keyboard behaviour as `Modal`. With reduced motion
 * the slide is an opacity fade (Motion drops the transform).
 */

export type SheetProps = Omit<DialogShellProps, "dialogClassName">;

const NARROW = "(max-width: 639px)";
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};

export function Sheet(props: SheetProps) {
  // Phones: up from the bottom. Wider: in from the right.
  const narrow = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  return (
    <DialogShell
      offset={narrow ? { y: SHEET_DISTANCE } : { x: SHEET_DISTANCE }}
      dialogClassName={
        "m-0 ml-auto h-dvh max-h-dvh w-full max-w-md rounded-l-xl " +
        "max-sm:h-auto max-sm:max-h-[90dvh] max-sm:max-w-none max-sm:mt-auto max-sm:rounded-l-none max-sm:rounded-t-xl"
      }
      {...props}
    />
  );
}
