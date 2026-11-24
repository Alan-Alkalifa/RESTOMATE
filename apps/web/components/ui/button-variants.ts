import { cn } from "./cn";

/**
 * The look of a button (DESIGN.md §6.1), with no React and no "use client": server components import
 * `buttonClasses` from here to style a link like a button. `button.tsx` (a client component) uses the
 * same table, so a button and a link that looks like one never drift apart.
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
