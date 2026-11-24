"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useI18n } from "@/components/i18n/provider";
import { OfflineBar } from "@/components/ui/offline-bar";
import { cn } from "@/components/ui/cn";
import { ShellIcon } from "./icons";
import { LocationSwitcher, type ShellLocation } from "./location-switcher";
import type { VisibleNavSection } from "./nav";

export type ShellOrg = { name: string; slug: string };
export type ShellUser = { email: string | null; roleName: string };

/**
 * The restaurant admin frame (DESIGN.md §6.5, §7.1): a secondary-800 sidebar (256 px, or a 72 px icon
 * rail), a 64 px white top bar, and the page. Under 1024 px the sidebar is a drawer behind the menu
 * button. The navigation arrives already filtered by the server; the sign-out button is a Server
 * Action passed in as a prop, so this file imports nothing from the server.
 */
export function AdminShell({
  org,
  user,
  nav,
  locations,
  signOutAction,
  children,
}: {
  org: ShellOrg;
  user: ShellUser;
  nav: VisibleNavSection[];
  locations: ShellLocation[];
  signOutAction: () => void | Promise<void>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [rail, setRail] = useState(false);
  // The drawer is open for one page only: navigating closes it without an effect.
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const drawer = drawerFor === pathname;
  const setDrawer = (open: boolean) => setDrawerFor(open ? pathname : null);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerFor(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const sidebar = (compact: boolean) => (
    <nav aria-label={t("admin.nav.label")} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className={cn("flex flex-col gap-3", compact && "items-center")}>
        <p className={cn("truncate text-h3 text-nav-text", compact && "sr-only")} title={org.name}>
          {org.name}
        </p>
        {!compact && (
          <Suspense fallback={<span className="skeleton h-11 w-full rounded-md" />}>
            <LocationSwitcher locations={locations} />
          </Suspense>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {nav.map((section) => (
          <div key={section.id} className="flex flex-col gap-1">
            {section.titleKey && (
              <p className={cn("px-3 text-caption uppercase text-nav-muted", compact && "sr-only")}>
                {t(section.titleKey)}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {section.entries.map((entry) => {
                const active =
                  entry.path === ""
                    ? pathname === entry.href
                    : pathname === entry.href || pathname.startsWith(`${entry.href}/`);
                return (
                  <li key={entry.id}>
                    <Link
                      href={entry.href}
                      aria-current={active ? "page" : undefined}
                      title={compact ? t(entry.labelKey) : undefined}
                      className={cn(
                        "relative flex min-h-11 items-center gap-3 rounded-md px-3 text-body-sm font-medium text-nav-text transition-colors hover:bg-secondary-700",
                        compact && "justify-center",
                        active && "bg-secondary-700",
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-2 left-0 w-1 rounded-full bg-nav-active"
                        />
                      )}
                      <ShellIcon name={entry.icon} />
                      <span className={cn(compact && "sr-only")}>{t(entry.labelKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-dominant-50">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 bg-nav-bg p-3 transition-[width] duration-base lg:flex",
          rail ? "w-18" : "w-64",
        )}
      >
        {sidebar(rail)}
        <button
          type="button"
          onClick={() => setRail((v) => !v)}
          aria-pressed={rail}
          aria-label={rail ? t("admin.sidebar.expand") : t("admin.sidebar.collapse")}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-body-sm text-nav-muted hover:bg-secondary-700 hover:text-nav-text"
        >
          <ShellIcon name={rail ? "expand" : "collapse"} />
          {!rail && <span>{t("admin.sidebar.collapse")}</span>}
        </button>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-dominant-900/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col gap-4 bg-nav-bg p-3">
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBar
          offlineMessage={t("common.offline.message")}
          backOnlineMessage={t("common.offline.back_online")}
        />
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-page md:px-page-md">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label={t("admin.menu.open")}
              aria-expanded={drawer}
              className="flex size-11 items-center justify-center rounded-md text-text hover:bg-surface-muted lg:hidden"
            >
              <ShellIcon name="menu" />
            </button>
            <span className="truncate text-body font-semibold text-text lg:hidden">{org.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <div className="hidden min-w-0 flex-col text-right sm:flex">
              <span className="truncate text-body-sm font-medium text-text">
                {user.email ?? ""}
              </span>
              <span className="truncate text-caption text-text-muted">{user.roleName}</span>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                aria-label={t("admin.signout")}
                title={t("admin.signout")}
                className="flex size-11 items-center justify-center rounded-md text-text hover:bg-surface-muted"
              >
                <ShellIcon name="signOut" />
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
