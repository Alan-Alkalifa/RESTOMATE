"use client";

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { m } from "motion/react";
import { PRESS_SCALE, transition } from "../motion/tokens";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-variants";
import { cn } from "./cn";
import { Spinner } from "./icons";

/**
 * Buttons (DESIGN.md §6.1). The classes live in `button-variants.ts` (no "use client"), so a server
 * component can style a link like a button; import `buttonClasses` from there, not from here.
 * Text comes from the caller: no string lives here.
 * One spotlight button per screen (§2.5); everything else steps down to primary, soft, outline or ghost.
 */

// Client components keep importing these from here; server components use `./button-variants`.
export { buttonClasses, type ButtonSize, type ButtonVariant };

/** Motion owns these handler names on `m.button`, with other types. */
type MotionOwned =
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd";

export type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, MotionOwned> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner next to the label and ignores presses. The width does not change. */
  loading?: boolean;
  /** An icon before the label. Decorative: the label names the action. */
  icon?: ReactNode;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  type = "button",
  onClick,
  children,
  style,
  ...rest
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const pressable = !loading && !rest.disabled;

  // Keep the width the button had before the spinner joined the label.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (loading) el.style.minWidth = `${el.getBoundingClientRect().width}px`;
    else el.style.minWidth = "";
  }, [loading]);

  return (
    <m.button
      ref={ref}
      whileTap={pressable ? { scale: PRESS_SCALE } : undefined}
      transition={transition.press}
      type={type}
      className={buttonClasses({ variant, size, className })}
      // `aria-disabled` (not `disabled`) while loading, so focus stays on the button.
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      style={style}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </m.button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children" | "icon" | "size"> & {
  /** The accessible name and the tooltip. Required: an icon alone says nothing to a screen reader. */
  label: string;
  /** The icon (decorative). */
  icon: ReactNode;
  size?: ButtonSize;
};

/** A square icon-only button. Always labelled (§5). */
export function IconButton({
  label,
  icon,
  size = "md",
  variant = "ghost",
  loading,
  className,
  ...rest
}: IconButtonProps) {
  const square = { sm: "w-control-sm", md: "w-control-md", lg: "w-control-lg" }[size];
  return (
    <Button
      variant={variant}
      size={size}
      loading={loading}
      aria-label={label}
      title={label}
      className={cn("px-0", square, className)}
      {...rest}
    >
      {loading ? null : icon}
    </Button>
  );
}
