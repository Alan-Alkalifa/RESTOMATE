import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Cards and surfaces (DESIGN.md §6.3): white `surface`, 1 px `border`, radius-lg, shadow-sm, 20 px padding.
 * A card that opens something gains shadow-md and a secondary-200 border on hover (`interactive`);
 * a selected card gets a 2 px secondary-600 border and a secondary-50 tint (`selected`).
 * `interactive` is the look only: put a real link or button inside, or render the card as one with `as`.
 */

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  padding?: "default" | "compact" | "marketing" | "none";
  interactive?: boolean;
  selected?: boolean;
};

const PADDING = {
  default: "p-card",
  compact: "p-card-compact",
  marketing: "p-card-marketing",
  none: "",
};

export function Card({
  as: Tag = "div",
  padding = "default",
  interactive = false,
  selected = false,
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      data-selected={selected || undefined}
      className={cn(
        "rounded-lg border bg-surface text-text shadow-sm",
        PADDING[padding],
        selected ? "border-2 border-secondary-600 bg-primary-soft" : "border-border",
        interactive &&
          "cursor-pointer transition-[box-shadow,border-color] duration-fast ease-enter hover:border-secondary-200 hover:shadow-md",
        className,
      )}
      {...rest}
    />
  );
}

/** A card title is an `h3` by default; pass the level that fits the page (never skip more than one). */
export function CardTitle({
  as: Tag = "h3",
  className,
  children,
}: {
  as?: "h2" | "h3" | "h4";
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={cn("text-h3 text-text", className)}>{children}</Tag>;
}
