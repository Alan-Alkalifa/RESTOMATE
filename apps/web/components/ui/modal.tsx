"use client";

import { DialogShell, type DialogShellProps } from "./dialog-shell";

/**
 * Modal (DESIGN.md §6.7): radius-xl, shadow-lg, 560 px wide (800 px wide variant), a dominant-900 overlay
 * at 40%. The title is an `h2`; the actions sit bottom-right with the primary action last. Escape, the
 * close button and a click on the backdrop all call `onClose`. A confirm dialog for something destructive
 * names the thing ("Void 2 x Nasi Goreng?") and puts the danger button last.
 */

export type ModalProps = Omit<DialogShellProps, "dialogClassName"> & { size?: "md" | "wide" };

export function Modal({ size = "md", ...rest }: ModalProps) {
  return (
    <DialogShell
      dialogClassName={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] rounded-xl ${
        size === "wide" ? "max-w-modal-wide" : "max-w-modal"
      }`}
      {...rest}
    />
  );
}
