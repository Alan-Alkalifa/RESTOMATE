"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/i18n/provider";
import { login, resendConfirmation } from "@/lib/actions/auth/actions";
import { loginSchema } from "@/lib/actions/auth/schemas";
import { FORGOT_PASSWORD_PATH } from "@/lib/auth/next";
import {
  AuthHeading,
  EmailField,
  FormErrorBanner,
  PasswordField,
  SubmitButton,
} from "./form-parts";
import { useAuthForm } from "./use-auth-form";

export function LoginForm({
  next,
  linkError,
}: {
  next?: string;
  linkError?: "invalid_link" | "unavailable";
}) {
  const { t } = useI18n();
  const [resent, setResent] = useState(false);
  const form = useAuthForm({
    initial: { email: "", password: "" },
    schema: loginSchema,
    extra: { next },
    submit: login,
  });
  const signupHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  async function resend() {
    const result = await resendConfirmation({ email: form.values.email });
    if (result?.ok) setResent(true);
    else if (result) form.setError(result.error);
  }

  return (
    <Card className="flex flex-col gap-5">
      <AuthHeading
        title={t("auth.screen.login.title")}
        subtitle={t("auth.screen.login.subtitle")}
      />
      {linkError ? (
        <div role="alert" className="rounded-md bg-warning-50 p-3 text-body-sm text-warning-700">
          <p className="font-semibold">
            {t(
              linkError === "invalid_link"
                ? "auth.screen.invalid_link.title"
                : "auth.screen.unavailable.title",
            )}
          </p>
          <p>
            {t(
              linkError === "invalid_link"
                ? "auth.screen.invalid_link.login"
                : "auth.screen.unavailable.description",
            )}
          </p>
        </div>
      ) : null}
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        <EmailField
          value={form.values.email}
          onChange={(v) => form.setValue("email", v)}
          error={form.fieldError("email")}
          autoFocus
        />
        <PasswordField
          name="password"
          label={t("auth.screen.field.password")}
          autoComplete="current-password"
          value={form.values.password}
          onChange={(v) => form.setValue("password", v)}
          error={form.fieldError("password")}
        />
        <FormErrorBanner error={form.error} onRetry={form.run} retrying={form.pending} />
        {form.error?.code === "email_not_confirmed" || linkError === "invalid_link" ? (
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={resend} disabled={!form.values.email}>
              {t("auth.screen.resend_confirmation.submit")}
            </Button>
            {resent ? (
              <p className="text-body-sm text-text-secondary">{t("auth.screen.check.resent")}</p>
            ) : null}
          </div>
        ) : null}
        <SubmitButton pending={form.pending}>{t("auth.screen.login.submit")}</SubmitButton>
        <Link
          href={FORGOT_PASSWORD_PATH}
          className="self-center text-body-sm font-semibold text-primary hover:underline"
        >
          {t("auth.screen.forgot.link")}
        </Link>
      </form>
      <p className="flex flex-wrap items-center justify-center gap-2 text-body-sm text-text-secondary">
        {t("auth.screen.login.no_account")}
        <Link href={signupHref} className={buttonClasses({ variant: "ghost", size: "sm" })}>
          {t("auth.screen.login.to_signup")}
        </Link>
      </p>
    </Card>
  );
}
