"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, m } from "motion/react";
import { DISTANCE, transition } from "../motion/tokens";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { IconButton } from "./button";

/**
 * Toasts (DESIGN.md §6.7): bottom-right (bottom-centre on phones and POS), white, radius-lg, shadow-lg,
 * with a coloured leading icon. They hide after 5 seconds; errors stay until dismissed. The timer pauses
 * while the pointer or the keyboard focus is on a toast, so an "Undo" is never taken away mid-click.
 * Escape on a focused toast dismisses it. Success and info are announced politely, errors assertively.
 * All text, including the dismiss label, comes from the caller.
 */

export type ToastTone = "success" | "info" | "warning" | "error";

export type ToastInput = {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  /** For "Undo" and the like. The toast closes after it runs. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds. Default 5000; an error stays until dismissed (use `Infinity` for another that must stay). */
  duration?: number;
};

type ToastItem = ToastInput & { id: number; tone: ToastTone };

type ToastApi = { show: (toast: ToastInput) => number; dismiss: (id: number) => void };
const ToastCtx = createContext<ToastApi | null>(null);

export const TOAST_DURATION_MS = 5000;

const TONES: Record<ToastTone, { icon: IconName; color: string }> = {
  success: { icon: "check", color: "text-success-600" },
  info: { icon: "info", color: "text-secondary-600" },
  warning: { icon: "warning", color: "text-warning-700" },
  error: { icon: "alert", color: "text-danger-600" },
};

export function ToastProvider({
  dismissLabel,
  placement = "right",
  children,
}: {
  /** The accessible name of each toast's close button. */
  dismissLabel: string;
  /** `center` for phones and POS. */
  placement?: "right" | "center";
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((all) => [...all, { ...toast, id, tone: toast.tone ?? "info" }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        className={cn(
          "pointer-events-none fixed bottom-0 z-50 flex w-full max-w-sm flex-col gap-2 p-page md:p-page-md",
          placement === "right"
            ? "right-0 max-sm:left-1/2 max-sm:-translate-x-1/2"
            : "left-1/2 -translate-x-1/2",
        )}
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <ToastView
              key={toast.id}
              toast={toast}
              dismissLabel={dismissLabel}
              onDismiss={dismiss}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({
  toast,
  dismissLabel,
  onDismiss,
}: {
  toast: ToastItem;
  dismissLabel: string;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const duration = toast.duration ?? (toast.tone === "error" ? Infinity : TOAST_DURATION_MS);
  const tone = TONES[toast.tone];

  useEffect(() => {
    if (paused || !Number.isFinite(duration)) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, onDismiss, toast.id]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") onDismiss(toast.id);
  }

  return (
    <m.div
      initial={{ opacity: 0, y: DISTANCE }}
      animate={{ opacity: 1, y: 0, transition: transition.enter }}
      exit={{ opacity: 0, y: DISTANCE, transition: transition.leave }}
      role={toast.tone === "error" ? "alert" : "status"}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-text shadow-lg"
    >
      <Icon name={tone.icon} size={20} className={cn("mt-0.5 shrink-0", tone.color)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body-sm font-semibold">{toast.title}</p>
        {toast.description ? (
          <p className="text-body-sm text-text-secondary">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            className="mt-1 inline-flex min-h-touch items-center self-start text-body-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <IconButton
        label={dismissLabel}
        icon={<Icon name="close" size={16} />}
        size="sm"
        onClick={() => onDismiss(toast.id)}
        className="-mr-2 -mt-1 shrink-0"
      />
    </m.div>
  );
}

/** `const toast = useToast(); toast.show({ tone: "success", title: t("saved") })`. */
export function useToast(): ToastApi {
  const api = useContext(ToastCtx);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
