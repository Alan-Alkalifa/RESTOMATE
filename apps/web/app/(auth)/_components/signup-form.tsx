"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/provider";
import { signup } from "@/lib/actions/auth/actions";
import { signupSchema } from "@/lib/actions/auth/schemas";
import { CheckEmail } from "./check-email";
import {
  AuthHeading,
  EmailField,
  FormErrorBanner,
  PasswordField,
  SubmitButton,
} from "./form-parts";
import { useAuthForm } from "./use-auth-form";

export function SignupForm({ next }: { next?: string }) {
  const { t, locale } = useI18n();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useAuthForm({
    initial: { fullName: "", email: "", password: "" },
    schema: signupSchema,
    extra: { next, locale },
    submit: signup,
    onSuccess: (_data, values) => setSentTo(values.email),
  });
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  if (sentTo !== null) {
    return <CheckEmail kind="signup" email={sentTo} onUseOther={() => setSentTo(null)} />;
  }

  return (
    <Card className="flex flex-col gap-5">
      <AuthHeading
        title={t("auth.screen.signup.title")}
        subtitle={t("auth.screen.signup.subtitle")}
      />
      <form onSubmit={form.onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label={t("auth.screen.field.full_name")}
          helper={t("auth.screen.field.optional")}
          error={form.fieldError("fullName")}
        >
          <Input
            name="fullName"
            autoComplete="name"
            value={form.values.fullName}
            onChange={(event) => form.setValue("fullName", event.target.value)}
          />
        </Field>
        <EmailField
          value={form.values.email}
          onChange={(v) => form.setValue("email", v)}
          error={form.fieldError("email")}
        />
        <PasswordField
          name="password"
          label={t("auth.screen.field.password")}
          helper={t("auth.screen.password.hint")}
          autoComplete="new-password"
          value={form.values.password}
          onChange={(v) => form.setValue("password", v)}
          error={form.fieldError("password")}
        />
        <FormErrorBanner error={form.error} onRetry={form.run} retrying={form.pending} />
        <SubmitButton pending={form.pending}>{t("auth.screen.signup.submit")}</SubmitButton>
      </form>
      <p className="flex flex-wrap items-center justify-center gap-2 text-body-sm text-text-secondary">
        {t("auth.screen.signup.have_account")}
        <Link href={loginHref} className={buttonClasses({ variant: "ghost", size: "sm" })}>
          {t("auth.screen.signup.to_login")}
        </Link>
      </p>
    </Card>
  );
}
