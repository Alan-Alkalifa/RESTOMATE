"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/i18n/provider";
import { resetPassword } from "@/lib/actions/auth/actions";
import { resetPasswordSchema } from "@/lib/actions/auth/schemas";
import { FORGOT_PASSWORD_PATH } from "@/lib/auth/next";
import { AuthHeading, FormErrorBanner, PasswordField, SubmitButton } from "./form-parts";
import { useAuthForm } from "./use-auth-form";

export function ResetForm() {
  const { t } = useI18n();
  const form = useAuthForm({
    initial: { password: "", confirmPassword: "" },
    schema: resetPasswordSchema,
    submit: resetPassword,
  });

  // The recovery session ended while the form was open: ask for a new link.
  const router = useRouter();
  const expired = form.error?.code === "unauthenticated";
  useEffect(() => {
    if (expired) router.replace(FORGOT_PASSWORD_PATH);
  }, [expired, router]);

  return (
    <Card className="flex flex-col gap-5">
      <AuthHeading
        title={t("auth.screen.reset.title")}
        subtitle={t("auth.screen.reset.subtitle")}
      />
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        <PasswordField
          name="password"
          label={t("auth.screen.field.new_password")}
          helper={t("auth.screen.password.hint")}
          autoComplete="new-password"
          value={form.values.password}
          onChange={(v) => form.setValue("password", v)}
          error={form.fieldError("password")}
        />
        <PasswordField
          name="confirmPassword"
          label={t("auth.screen.field.confirm_password")}
          autoComplete="new-password"
          value={form.values.confirmPassword}
          onChange={(v) => form.setValue("confirmPassword", v)}
          error={form.fieldError("confirmPassword")}
        />
        <FormErrorBanner error={form.error} onRetry={form.run} retrying={form.pending} />
        <SubmitButton pending={form.pending}>{t("auth.screen.reset.submit")}</SubmitButton>
      </form>
    </Card>
  );
}
