"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/provider";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { MAX_OWNED_ORGS } from "@/lib/actions/organization/schemas";

/** The user owns the most restaurants allowed. The database decides; this only warns before the form. */
export function AtCapNotice() {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col gap-4" role="status">
      <h1 className="text-h2 text-text">{t("onboarding.cap.title")}</h1>
      <p className="text-body text-text-secondary">
        {t("onboarding.cap.description", { count: MAX_OWNED_ORGS })}
      </p>
      <Link href="/app" className={buttonClasses({ variant: "primary", className: "self-start" })}>
        {t("onboarding.cap.back")}
      </Link>
    </Card>
  );
}

/** Auth or the database could not be reached. Nothing changed; this is not "signed out". */
export function UnavailableNotice() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <ErrorState
      title={t("error.unavailable")}
      retryLabel={t("common.retry")}
      onRetry={() => router.refresh()}
    />
  );
}
