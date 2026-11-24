"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Field, Input, type InputProps } from "@/components/ui/field";
import { useI18n } from "@/components/i18n/provider";
import type { FormError } from "./use-auth-form";

/** The top-of-form message for an answer that is not about one field. Nothing the user typed is echoed. */
export function FormErrorBanner({
  error,
  onRetry,
  retrying,
}: {
  error: FormError | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { t } = useI18n();
  if (!error) return null;
  const formKey = error.fieldErrors?.form?.[0];
  // A validation answer is shown beside its fields; only a form-level key needs the banner.
  if (error.code === "validation" && !formKey) return null;
  const retryable = error.code === "unavailable" || error.code === "unknown";
  return (
    <ErrorState
      title={formKey ? t(formKey) : t(`error.${error.code}`)}
      retryLabel={retryable && onRetry ? t("common.retry") : undefined}
      onRetry={retryable ? onRetry : undefined}
      retrying={retrying}
    />
  );
}

/** A password field. The browser's own password manager and show/hide controls do the rest. */
export function PasswordField({
  label,
  helper,
  error,
  value,
  onChange,
  autoComplete,
  name,
}: {
  label: string;
  helper?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: InputProps["autoComplete"];
  name: string;
}) {
  return (
    <Field label={label} helper={helper} error={error} required>
      <Input
        name={name}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function EmailField({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Field label={t("auth.screen.field.email")} error={error} required>
      <Input
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** The page heading and one line under it. The page title is the `h1`. */
export function AuthHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-h2 text-text">{title}</h1>
      {subtitle ? <p className="text-body text-text-secondary">{subtitle}</p> : null}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" size="lg" loading={pending} className="w-full">
      {children}
    </Button>
  );
}
