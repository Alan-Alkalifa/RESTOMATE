"use client";

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { m } from "motion/react";
import { PRESS_SCALE, transition } from "../motion/tokens";
import { cn } from "./cn";
import { Spinner } from "./icons";

/**
 * Buttons (DESIGN.md §6.1). Text comes from the caller: no string lives here.
 * One spotlight button per screen (§2.5); everything else steps down to primary, soft, outline or ghost.
 */

export type ButtonVariant = "primary" | "spotlight" | "soft" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold " +
  "transition-colors duration-fast ease-enter " +
  "disabled:cursor-not-allowed disabled:bg-dominant-100 disabled:text-text-muted disabled:shadow-none " +
  "aria-disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary shadow-xs hover:bg-primary-hover active:bg-primary-pressed",
  spotlight: "bg-accent text-on-accent shadow-sm hover:bg-accent-hover active:bg-accent-pressed",
  soft: "bg-primary-soft text-secondary-700 hover:bg-secondary-100 active:bg-secondary-200",
  outline:
    "border border-border-control bg-surface text-text hover:bg-surface-muted active:bg-dominant-200",
  ghost: "bg-transparent text-secondary-700 hover:bg-primary-soft active:bg-secondary-100",
  danger: "bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-700",
};

/** Heights are the ones in §6.1. The ::before widens the hit area of sm and md to the 44 px target of §4.4. */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-control-sm px-3 text-body-sm before:absolute before:inset-x-0 before:top-1/2 before:h-touch before:-translate-y-1/2",
  md: "h-control-md px-4 text-body-sm before:absolute before:inset-x-0 before:top-1/2 before:h-touch before:-translate-y-1/2",
  lg: "h-control-lg px-5 text-body",
};

/** The classes of a button, for a link that looks like one (`<Link className={buttonClasses({...})}>`). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

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
