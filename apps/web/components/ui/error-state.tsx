"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { Icon } from "./icons";

/**
 * Error (DESIGN.md §6.8): an inline danger-soft panel with what happened, what to do and a "Try again"
 * button. Never a raw error code: the caller passes plain-language text. It keeps the user's input on the
 * page around it; this panel only reports. All text is a prop.
 */

export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  retrying = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The label of the retry button. Leave `onRetry` out to show no button. */
  retryLabel?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-danger-600/30 bg-danger-50 p-card text-danger-700",
        className,
      )}
    >
      <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-body font-semibold">{title}</p>
          {description ? <p className="text-body-sm">{description}</p> : null}
        </div>
        {onRetry && retryLabel ? (
          <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
