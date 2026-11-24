"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useI18n } from "@/components/i18n/provider";
import { OfflineBar } from "@/components/ui/offline-bar";

/**
 * The super admin frame (DESIGN.md §6.5, §7.1): a dominant-900 sidebar with the accent "PLATFORM
 * ADMIN" label, so nobody mistakes it for a restaurant's dashboard. Navigation entries arrive with
 * the pages that need them (tenants, packages, settings: M1); today there is the overview.
 */
export function PlatformShell({
  signOutAction,
  children,
}: {
  signOutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh bg-dominant-50">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 bg-dominant-900 p-3 lg:flex">
        <div className="flex flex-col gap-1 px-3 pt-2">
          <span className="text-h3 text-on-secondary">{t("auth.screen.brand")}</span>
          <span className="text-caption font-bold uppercase tracking-caption text-accent-400">
            {t("platform.label")}
          </span>
        </div>
        <nav aria-label={t("platform.nav.label")} className="flex flex-col gap-1">
          <Link
            href="/admin"
            aria-current="page"
            className="flex min-h-11 items-center rounded-md bg-dominant-800 px-3 text-body-sm font-medium text-on-secondary"
          >
            {t("platform.nav.overview")}
          </Link>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBar
          offlineMessage={t("common.offline.message")}
          backOnlineMessage={t("common.offline.back_online")}
        />
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-page md:px-page-md">
          <span className="text-caption font-bold uppercase tracking-caption text-text lg:hidden">
            {t("platform.label")}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSwitch />
            <form action={signOutAction}>
              <button
                type="submit"
                className="min-h-11 rounded-md px-3 text-body-sm font-medium text-text hover:bg-surface-muted"
              >
                {t("admin.signout")}
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-page py-6 md:px-page-md lg:px-page-lg">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PlatformLoading() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" aria-label={t("common.loading")} className="flex min-h-dvh">
      <span className="hidden w-64 bg-dominant-900 lg:block" />
      <div className="flex flex-1 flex-col" aria-hidden="true">
        <span className="h-16 border-b border-border bg-surface" />
        <div className="p-page md:p-page-md">
          <span className="skeleton block h-8 w-1/3 rounded-md" />
        </div>
      </div>
    </div>
  );
}
