import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

/**
 * Empty (DESIGN.md §6.8): a small illustration, one friendly sentence and the primary action
 * ("No tables yet. Add your first area to start your floor plan."). The illustration is a slot: pass
 * a spot illustration, or leave it for a neutral icon. All text is a prop.
 */

export function EmptyState({
  title,
  description,
  action,
  illustration,
  headingLevel = 2,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The primary action, usually a `Button`. */
  action?: ReactNode;
  illustration?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("flex flex-col items-center gap-4 px-page py-10 text-center", className)}>
      <div
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-primary-soft text-secondary-600"
      >
        {illustration ?? <Icon name="inbox" size={32} />}
      </div>
      <div className="flex max-w-prose flex-col gap-1">
        <Heading className="text-h3 text-text">{title}</Heading>
        {description ? <p className="text-body text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
