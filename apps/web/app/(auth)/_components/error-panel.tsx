"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/provider";
import { ErrorState } from "@/components/ui/error-state";

/** Auth could not be reached. Nothing was changed; this is not "signed out". */
export function ErrorPanel() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <ErrorState
      title={t("auth.screen.unavailable.title")}
      description={t("auth.screen.unavailable.description")}
      retryLabel={t("common.retry")}
      onRetry={() => router.refresh()}
    />
  );
}
