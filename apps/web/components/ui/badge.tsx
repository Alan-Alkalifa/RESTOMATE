import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Badges and status (DESIGN.md §6.4): a pill, `caption` text, a leading icon or dot, the soft fill with
 * the dark text. Status is never colour alone: the text says it, and a dot or an icon repeats it.
 */

export type BadgeTone =
  "info" | "success" | "warning" | "danger" | "neutral" | "neutral-muted" | "accent";

const TONES: Record<BadgeTone, { box: string; dot: string }> = {
  info: { box: "bg-primary-soft text-secondary-700", dot: "bg-secondary-700" },
  success: { box: "bg-success-50 text-success-700", dot: "bg-success-700" },
  warning: { box: "bg-warning-50 text-warning-700", dot: "bg-warning-700" },
  danger: { box: "bg-danger-50 text-danger-700", dot: "bg-danger-700" },
  neutral: { box: "bg-surface-muted text-text-secondary", dot: "bg-text-secondary" },
  "neutral-muted": { box: "bg-surface-muted text-text-muted", dot: "bg-text-muted" },
  // The "New" chip: a filled accent shape with its own text, never accent as text or a thin line (§2.5).
  accent: { box: "bg-accent-100 text-accent-700", dot: "bg-accent-700" },
};

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  tone?: BadgeTone;
  /** A decorative icon before the text. Without one, a dot is shown (set `dot={false}` to hide it). */
  icon?: ReactNode;
  dot?: boolean;
  children: ReactNode;
};

export function Badge({
  tone = "neutral",
  icon,
  dot = true,
  className,
  children,
  ...rest
}: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-caption uppercase tracking-caption",
        t.box,
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : dot ? (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
      ) : null}
      {children}
    </span>
  );
}
