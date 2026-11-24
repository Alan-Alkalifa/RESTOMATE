"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/provider";
import { ErrorState } from "@/components/ui/error-state";

export function StaffLoading() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("common.loading")}
      className="flex flex-col gap-4"
    >
      <span className="skeleton h-9 w-1/4 rounded-md" aria-hidden="true" />
      <span className="skeleton h-64 w-full rounded-lg" aria-hidden="true" />
    </div>
  );
}

/** A read failed. Never a partial list; nothing was changed. */
export function StaffUnavailable() {
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
