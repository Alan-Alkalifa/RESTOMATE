"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useI18n } from "@/components/i18n/provider";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { OfflineBar } from "@/components/ui/offline-bar";

export function InviteChrome({ children }: { children: ReactNode }) {
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

/**
 * The one page for every bad link: unknown, malformed, used, revoked, expired, a suspended
 * restaurant, or an invitation for another address. It says nothing about which, so a guess learns
 * nothing (staff.md "previewInvitation").
 */
export function InviteInvalid() {
  const { t } = useI18n();
  return (
    <Card role="status" className="flex flex-col gap-3">
      <h1 className="text-h2 text-text">{t("staff.invite_page.invalid.title")}</h1>
      <p className="text-body text-text-secondary">{t("staff.invite_page.invalid.description")}</p>
      <Link href="/app" className={buttonClasses({ variant: "soft", className: "self-start" })}>
        {t("staff.invite_page.invalid.action")}
      </Link>
    </Card>
  );
}

/** The lookup itself failed (not a bad link): offer a retry. */
export function InviteUnavailable() {
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

export function InviteLoading() {
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
        <span className="skeleton h-12 w-full rounded-md" />
      </div>
    </div>
  );
}
