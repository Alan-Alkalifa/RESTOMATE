"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "./provider";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, LOCALE_COOKIE_MAX_AGE, type Locale } from "./locale";

/**
 * The language switch: a native `<select>` (keyboard and screen reader friendly, 44 px target). It stores
 * the choice in a plain cookie and refreshes, so the server renders the new language. Language names
 * stay in their own language ("Bahasa Indonesia") so a visitor can always find theirs.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(next: Locale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    start(() => router.refresh());
  }

  return (
    <label className={className}>
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(event) => choose(event.target.value as Locale)}
        className="h-control-md min-h-touch rounded-md border border-border-control bg-surface px-3 text-body-sm text-text"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
