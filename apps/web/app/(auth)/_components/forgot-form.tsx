"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/provider";
import { requestPasswordReset } from "@/lib/actions/auth/actions";
import { forgotPasswordSchema } from "@/lib/actions/auth/schemas";
import { LOGIN_PATH } from "@/lib/auth/next";
import { CheckEmail } from "./check-email";
import { AuthHeading, EmailField, FormErrorBanner, SubmitButton } from "./form-parts";
import { useAuthForm } from "./use-auth-form";

export function ForgotForm({ linkError }: { linkError?: "invalid_link" | "unavailable" }) {
  const { t } = useI18n();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useAuthForm({
    initial: { email: "" },
    schema: forgotPasswordSchema,
    submit: requestPasswordReset,
    onSuccess: (_data, values) => setSentTo(values.email),
  });

  if (sentTo !== null) {
    return <CheckEmail kind="reset" email={sentTo} onUseOther={() => setSentTo(null)} />;
  }

  return (
    <Card className="flex flex-col gap-5">
      <AuthHeading
        title={t("auth.screen.forgot.title")}
        subtitle={t("auth.screen.forgot.subtitle")}
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
                ? "auth.screen.invalid_link.forgot"
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
        <FormErrorBanner error={form.error} onRetry={form.run} retrying={form.pending} />
        <SubmitButton pending={form.pending}>{t("auth.screen.forgot.submit")}</SubmitButton>
      </form>
      <Link
        href={LOGIN_PATH}
        className={buttonClasses({ variant: "ghost", size: "sm", className: "self-center" })}
      >
        {t("auth.screen.forgot.back")}
      </Link>
    </Card>
  );
}
