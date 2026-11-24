"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import { transition } from "../motion/tokens";
import { cn } from "./cn";
import { Icon } from "./icons";
import { IconButton } from "./button";

/**
 * The shared body of `Modal` and `Sheet`: a native <dialog> opened with `showModal()`. The browser gives
 * the focus trap (the page behind is inert), the top layer and the `Escape` key; this component adds
 * what the platform leaves out: it keeps `open` in sync, locks page scroll, puts focus back on the
 * control that opened it, closes on a click on the backdrop, and names the dialog.
 */

let scrollLocks = 0;
function lockScroll() {
  if (scrollLocks++ === 0) document.documentElement.style.overflow = "hidden";
}
function unlockScroll() {
  if (--scrollLocks <= 0) {
    scrollLocks = 0;
    document.documentElement.style.overflow = "";
  }
}

export type DialogShellProps = {
  open: boolean;
  /** Called for Escape, the close button and a click on the backdrop. The parent sets `open` to false. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** The accessible name of the close button. From the caller's translations. */
  closeLabel: string;
  /** Actions, bottom-right, the primary action last. */
  footer?: ReactNode;
  /** Close on a click on the backdrop (default true). Turn off when a form would lose input. */
  dismissOnBackdrop?: boolean;
  dialogClassName: string;
  /** Where the dialog starts when it enters and ends when it leaves, in px (transform only). */
  offset?: { x?: number; y?: number };
  /** The `h2` of the title is `h2`; keep it. */
  children: ReactNode;
};

export function DialogShell({
  open,
  onClose,
  title,
  description,
  closeLabel,
  footer,
  dismissOnBackdrop = true,
  dialogClassName,
  offset = { y: 8 },
  children,
}: DialogShellProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  // The content stays while the dialog fades out, then goes (so a form inside starts fresh next time).
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);

  // The exit has finished: now the native dialog may close, scroll unlocks and focus goes back.
  const finishClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog?.open) return;
    dialog.close();
    unlockScroll();
    returnTo.current?.focus();
    returnTo.current = null;
    setShown(false);
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open || dialog.open) return;
    returnTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    lockScroll();
  }, [open]);

  // If the component unmounts while open, release the lock and give focus back.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) {
        dialog.close();
        unlockScroll();
        returnTo.current?.focus();
      }
    };
  }, []);

  const hidden = { opacity: 0, x: offset.x ?? 0, y: offset.y ?? 0 };

  // Self-contained on purpose: a dialog that never finishes its exit would never close, so it must not
  // depend on a provider being mounted. The features load once and are shared with `MotionProvider`.
  return (
    <LazyMotion features={domAnimation}>
      <m.dialog
        ref={ref}
        initial="out"
        animate={open ? "in" : "out"}
        variants={{
          out: { ...hidden, transition: transition.leave },
          in: { opacity: 1, x: 0, y: 0, transition: transition.enterSlow },
        }}
        onAnimationComplete={(definition) => {
          if (definition === "out") finishClose();
        }}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        // Escape: the parent owns `open`, so keep the dialog open until it says otherwise.
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onClick={(event) => {
          if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
        }}
        className={cn(
          "bg-surface p-0 text-left text-text shadow-lg backdrop:bg-dominant-900/40 backdrop:animate-fade-in open:flex open:flex-col",
          dialogClassName,
        )}
      >
        {shown ? (
          <>
            <div className="flex items-start justify-between gap-4 px-card pt-card">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id={titleId} className="text-h2 text-text">
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="text-body-sm text-text-secondary">
                    {description}
                  </p>
                ) : null}
              </div>
              <IconButton
                label={closeLabel}
                icon={<Icon name="close" />}
                size="sm"
                onClick={onClose}
                className="-mr-2 -mt-1 shrink-0"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-card py-4">{children}</div>
            {footer ? (
              <div className="flex flex-wrap items-center justify-end gap-3 px-card pb-card pt-2">
                {footer}
              </div>
            ) : null}
          </>
        ) : null}
      </m.dialog>
    </LazyMotion>
  );
}
