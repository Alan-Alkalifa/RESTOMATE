"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { useI18n } from "@/components/i18n/provider";
import { resendConfirmation } from "@/lib/actions/auth/actions";
import { AuthHeading, FormErrorBanner } from "./form-parts";
import type { FormError } from "./use-auth-form";

const RESEND_WAIT_SECONDS = 30;

/**
 * "Check your email". The words never say whether the address has an account (the answer is the same
 * for every address). `kind="signup"` can send the confirmation again after a short wait.
 */
export function CheckEmail({
  kind,
  onUseOther,
  email,
}: {
  kind: "signup" | "reset";
  onUseOther: () => void;
  email: string;
}) {
  const { t } = useI18n();
  const [wait, setWait] = useState(RESEND_WAIT_SECONDS);
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function resend() {
    setSending(true);
    setError(null);
    try {
      const result = await resendConfirmation({ email });
      if (result?.ok) {
        setResent(true);
        setWait(RESEND_WAIT_SECONDS);
      } else if (result) setError(result.error);
    } catch {
      setError({ code: "unavailable" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4" role="status">
      <Icon name="inbox" size={32} className="text-primary" />
      <AuthHeading
        title={t("auth.screen.check.title")}
        subtitle={t(kind === "signup" ? "auth.screen.check.signup" : "auth.screen.check.reset")}
      />
      <p className="text-body-sm text-text-muted">{t("auth.screen.check.spam")}</p>
      {resent ? (
        <p className="text-body-sm text-text-secondary">{t("auth.screen.check.resent")}</p>
      ) : null}
      <FormErrorBanner error={error} />
      <div className="flex flex-col gap-2">
        {kind === "signup" ? (
          <Button variant="outline" onClick={resend} loading={sending} disabled={wait > 0}>
            {wait > 0
              ? t("auth.screen.check.resend_wait", { seconds: wait })
              : t("auth.screen.check.resend")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onUseOther}>
          {t("auth.screen.check.use_other")}
        </Button>
      </div>
    </Card>
  );
}
