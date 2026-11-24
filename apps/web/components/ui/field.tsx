"use client";

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

/**
 * Form controls (DESIGN.md §6.2). Built on the native elements: <input>, <select>, <textarea>.
 * Every control sits in a `Field`, which gives it a label, helper text and an error linked with
 * `aria-describedby`. An error is never colour alone: it has an icon and a message. All text is a prop.
 */

type FieldContext = { id: string; describedBy?: string; invalid: boolean; required: boolean };
const FieldCtx = createContext<FieldContext | null>(null);

/** What a control needs from its Field (or from its own props when used on its own). */
function useControl(own: {
  id?: string;
  invalid?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
}) {
  const ctx = useContext(FieldCtx);
  const fallbackId = useId();
  return {
    id: own.id ?? ctx?.id ?? fallbackId,
    invalid: own.invalid ?? ctx?.invalid ?? false,
    required: own.required ?? ctx?.required ?? false,
    describedBy: [own["aria-describedby"], ctx?.describedBy].filter(Boolean).join(" ") || undefined,
  };
}

export function FieldMessage({
  id,
  tone,
  children,
}: {
  id?: string;
  tone: "error" | "helper";
  children: ReactNode;
}) {
  if (tone === "helper") {
    return (
      <p id={id} className="text-body-sm text-text-muted">
        {children}
      </p>
    );
  }
  return (
    <p id={id} className="flex items-start gap-1.5 text-body-sm text-danger-700">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export type FieldProps = {
  label: ReactNode;
  /** Helper text under the control (body-sm, text-muted). */
  helper?: ReactNode;
  /** The error message. When set, the control is invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Hide the label visually (it still names the control for a screen reader). */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label above, control, then the helper or the error. 16 px between fields, 6 px between label and control. */
export function Field({
  label,
  helper,
  error,
  required = false,
  hideLabel = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldCtx.Provider value={{ id, describedBy, invalid: Boolean(error), required }}>
      <div className={cn("flex flex-col gap-label", className)}>
        <label
          htmlFor={id}
          className={cn("text-body-sm font-medium text-text", hideLabel && "sr-only")}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-danger-700">
              *
            </span>
          ) : null}
        </label>
        {children}
        {error ? (
          <FieldMessage id={errorId} tone="error">
            {error}
          </FieldMessage>
        ) : null}
        {helper ? (
          <FieldMessage id={helperId} tone="helper">
            {helper}
          </FieldMessage>
        ) : null}
      </div>
    </FieldCtx.Provider>
  );
}

export type ControlSize = "md" | "lg";

/** White fill, 1 px control border, radius-md, 40 px tall (48 px on touch surfaces), 12 px side padding. */
const CONTROL =
  "w-full rounded-md border bg-surface px-3 text-body text-text shadow-xs transition-colors duration-fast ease-enter " +
  "placeholder:text-text-muted hover:bg-dominant-50 " +
  "focus-visible:border-secondary-600 " +
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-dominant-100 disabled:text-text-muted disabled:shadow-none " +
  "read-only:bg-surface-muted";
const HEIGHT: Record<ControlSize, string> = { md: "h-control-md", lg: "h-control-lg" };

function borderFor(invalid: boolean) {
  return invalid ? "border-danger-600" : "border-border-control";
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & {
  invalid?: boolean;
  size?: ControlSize;
  /** Inside the field, before the text: for money, `Rp`. Decorative, so the label should say the unit too. */
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Numbers, prices and timers line up. */
  numeric?: boolean;
};

export function Input({
  invalid,
  size = "md",
  prefix,
  suffix,
  numeric,
  className,
  ...rest
}: InputProps) {
  const c = useControl({
    id: rest.id,
    invalid,
    required: rest.required,
    "aria-describedby": rest["aria-describedby"],
  });
  const input = (
    <input
      {...rest}
      id={c.id}
      aria-invalid={c.invalid || undefined}
      aria-describedby={c.describedBy}
      required={c.required || undefined}
      className={cn(
        CONTROL,
        HEIGHT[size],
        borderFor(c.invalid),
        numeric && "tabular-nums",
        prefix ? "pl-10" : undefined,
        suffix ? "pr-10" : undefined,
        className,
      )}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-body-sm text-text-secondary">
          {prefix}
        </span>
      ) : null}
      {input}
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body-sm text-text-secondary">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  const c = useControl({
    id: rest.id,
    invalid,
    required: rest.required,
    "aria-describedby": rest["aria-describedby"],
  });
  return (
    <textarea
      {...rest}
      rows={rows}
      id={c.id}
      aria-invalid={c.invalid || undefined}
      aria-describedby={c.describedBy}
      required={c.required || undefined}
      className={cn(CONTROL, "min-h-24 py-2", borderFor(c.invalid), className)}
    />
  );
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  invalid?: boolean;
  size?: ControlSize;
};

/** The native <select>: the platform's own picker works on every device and by keyboard. */
export function Select({ invalid, size = "md", className, children, ...rest }: SelectProps) {
  const c = useControl({
    id: rest.id,
    invalid,
    required: rest.required,
    "aria-describedby": rest["aria-describedby"],
  });
  return (
    <select
      {...rest}
      id={c.id}
      aria-invalid={c.invalid || undefined}
      aria-describedby={c.describedBy}
      required={c.required || undefined}
      className={cn(CONTROL, HEIGHT[size], borderFor(c.invalid), "pr-8", className)}
    >
      {children}
    </select>
  );
}

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label: ReactNode;
  helper?: ReactNode;
  invalid?: boolean;
};

/** The label is part of the target: 44 px tall at least, and the whole row toggles. */
function Choice({
  type,
  label,
  helper,
  invalid,
  className,
  ...rest
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  const c = useControl({ id: rest.id, invalid, "aria-describedby": rest["aria-describedby"] });
  const helperId = helper ? `${c.id}-helper` : undefined;
  const describedBy = [c.describedBy, helperId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex min-h-touch items-start gap-3 py-2.5">
      <span className="relative mt-0.5 size-5 shrink-0">
        <input
          {...rest}
          id={c.id}
          type={type}
          aria-invalid={c.invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            "peer size-5 cursor-pointer appearance-none border bg-surface transition-colors duration-fast ease-enter",
            type === "checkbox" ? "rounded-sm" : "rounded-full",
            borderFor(c.invalid),
            "hover:border-secondary-600 checked:border-secondary-600 checked:bg-primary",
            "disabled:cursor-not-allowed disabled:border-border disabled:bg-dominant-100 disabled:checked:bg-dominant-300",
            className,
          )}
        />
        {/* The mark sits on top of the native input and only shows when it is checked. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden items-center justify-center text-on-primary peer-checked:flex"
        >
          {type === "checkbox" ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
          ) : (
            <span className="size-2 rounded-full bg-on-primary" />
          )}
        </span>
      </span>
      <div className="flex flex-col">
        <label htmlFor={c.id} className="cursor-pointer text-body text-text">
          {label}
        </label>
        {helper ? (
          <FieldMessage id={helperId} tone="helper">
            {helper}
          </FieldMessage>
        ) : null}
      </div>
    </div>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label: ReactNode;
  helper?: ReactNode;
};

/** A pill switch: a native checkbox with `role="switch"`, secondary-600 when on. */
export function Switch({ label, helper, className, ...rest }: SwitchProps) {
  const c = useControl({ id: rest.id, "aria-describedby": rest["aria-describedby"] });
  const helperId = helper ? `${c.id}-helper` : undefined;
  return (
    <div className="flex min-h-touch items-start gap-3 py-2.5">
      <span className="relative mt-px h-6 w-11 shrink-0">
        <input
          {...rest}
          id={c.id}
          type="checkbox"
          role="switch"
          aria-describedby={[c.describedBy, helperId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "peer h-6 w-11 cursor-pointer appearance-none rounded-full border border-border-control bg-dominant-300 transition-colors duration-fast ease-enter",
            "checked:border-secondary-600 checked:bg-primary disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 top-0.5 size-5 rounded-full bg-surface shadow-xs transition-transform duration-fast ease-enter peer-checked:translate-x-5 motion-reduce:transition-none"
        />
      </span>
      <div className="flex flex-col">
        <label htmlFor={c.id} className="cursor-pointer text-body text-text">
          {label}
        </label>
        {helper ? (
          <FieldMessage id={helperId} tone="helper">
            {helper}
          </FieldMessage>
        ) : null}
      </div>
    </div>
  );
}
