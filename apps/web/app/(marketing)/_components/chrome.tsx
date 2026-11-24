"use client";

import Link from "next/link";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useI18n } from "@/components/i18n/provider";
import { buttonClasses } from "@/components/ui/button";

export function MarketingHeader() {
  const { t } = useI18n();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-page md:px-page-md lg:px-page-lg">
        <Link href="/" className="text-h3 text-primary">
          {t("auth.screen.brand")}
        </Link>
        <nav aria-label={t("marketing.nav.label")} className="flex items-center gap-3">
          <LanguageSwitch />
          <Link href="/login" className={buttonClasses({ variant: "ghost" })}>
            {t("marketing.nav.login")}
          </Link>
          <Link href="/signup" className={buttonClasses({ variant: "primary" })}>
            {t("marketing.nav.signup")}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-page py-6 text-body-sm text-text-secondary md:px-page-md lg:px-page-lg">
        <span>{t("marketing.footer.copy", { year: new Date().getFullYear() })}</span>
        <span>{t("marketing.footer.tagline")}</span>
      </div>
    </footer>
  );
}
