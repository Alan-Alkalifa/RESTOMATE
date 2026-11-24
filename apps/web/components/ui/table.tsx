import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Tables and lists (DESIGN.md §6.6): a white surface in a card, a `surface-muted` header row with
 * uppercase `caption` labels, 52 px rows (44 px compact), a `border` divider, hover `dominant-50`,
 * selected `secondary-50`. Numeric columns are right-aligned and tabular. On phones a table becomes
 * stacked cards: each cell then shows its column label (the `label` prop of `TD`).
 */

export function Table({
  caption,
  className,
  wrapperClassName,
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement> & {
  /** Names the table (and its scroll area) for a screen reader. Required, and from the caller's translations. */
  caption: string;
  wrapperClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface shadow-sm",
        wrapperClassName,
      )}
    >
      {/* A keyboard user can scroll a wide table. */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
        <table
          className={cn(
            "w-full border-collapse text-left text-body-sm text-text max-md:block",
            className,
          )}
          {...rest}
        >
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  // On phones the header row is hidden: each stacked cell carries its own label.
  return <thead className={cn("max-md:sr-only", className)} {...rest} />;
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("max-md:block", className)} {...rest} />;
}

export function TR({
  selected = false,
  compact = false,
  className,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; compact?: boolean }) {
  return (
    <tr
      data-selected={selected || undefined}
      className={cn(
        "border-b border-border last:border-b-0 transition-colors duration-fast ease-enter",
        "max-md:block max-md:p-card-compact",
        compact ? "md:h-row-compact" : "md:h-row",
        selected ? "bg-primary-soft" : "hover:bg-dominant-50",
        className,
      )}
      {...rest}
    />
  );
}

export function TH({
  numeric = false,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope={rest.scope ?? "col"}
      className={cn(
        "bg-surface-muted px-4 py-3 text-caption uppercase tracking-caption text-text-secondary",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    />
  );
}

export function TD({
  numeric = false,
  label,
  className,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean;
  /** The column's name, shown beside the value when the table is stacked on a phone. */
  label?: ReactNode;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle",
        numeric && "text-right tabular-nums",
        "max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1.5",
        className,
      )}
      {...rest}
    >
      {label ? (
        <span
          aria-hidden="true"
          className="text-caption uppercase tracking-caption text-text-muted md:hidden"
        >
          {label}
        </span>
      ) : null}
      <span className={numeric ? "max-md:text-right" : undefined}>{children}</span>
    </td>
  );
}
