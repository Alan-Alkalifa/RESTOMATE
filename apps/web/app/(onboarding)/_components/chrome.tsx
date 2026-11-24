"use client";

import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useI18n } from "@/components/i18n/provider";
import { OfflineBar } from "@/components/ui/offline-bar";

export function OnboardingChrome({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col bg-surface-muted">
      <OfflineBar
        offlineMessage={t("common.offline.message")}
        backOnlineMessage={t("common.offline.back_online")}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-page py-10 md:px-page-md">
        <header className="flex items-center justify-between gap-4">
          <span className="text-h3 text-primary">{t("auth.screen.brand")}</span>
          <LanguageSwitch />
        </header>
        {children}
      </main>
    </div>
  );
}

/** Shown while the page reads the session and the user's restaurants. */
export function OnboardingLoading() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("common.loading")}
      className="rounded-lg border border-border bg-surface p-card"
    >
      <div className="flex flex-col gap-4" aria-hidden="true">
        <span className="skeleton h-8 w-2/3 rounded-md" />
        <span className="skeleton h-10 w-full rounded-md" />
        <span className="skeleton h-10 w-full rounded-md" />
        <span className="skeleton h-10 w-full rounded-md" />
        <span className="skeleton h-12 w-full rounded-md" />
      </div>
    </div>
  );
}
