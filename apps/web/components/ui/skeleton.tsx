import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Loading (DESIGN.md §6.8): skeletons in `surface-muted` that match the final layout. The shimmer stops
 * with reduced motion. Spinners only live inside buttons.
 */

/** One block. Decorative: hide it from a screen reader; the group says "loading". */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn("skeleton block h-4 w-full rounded-md", className)}
      {...rest}
    />
  );
}

/** Lines of text; the last one is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 && lines > 1 ? "w-2/3" : undefined} />
      ))}
    </span>
  );
}

/**
 * Wraps the skeletons of one area. `label` is read by a screen reader ("Loading orders") and comes from
 * the caller's translations.
 */
export function SkeletonGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
