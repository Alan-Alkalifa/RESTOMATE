/** Languages (PROJECT: English and Bahasa Indonesia). No server or client code here: safe anywhere. */
export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** A plain preference cookie (not personal data, not a secret), so the client may write it. */
export const LOCALE_COOKIE = "restomate-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The cookie wins, then the browser's `Accept-Language`, then English. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    const base = tag.split("-")[0];
    // `in` is the old code for Indonesian.
    if (base === "id" || base === "in") return "id";
    if (base === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

/** The BCP 47 tag used for `Intl`. */
export function intlTag(locale: Locale): string {
  return locale === "id" ? "id-ID" : "en-GB";
}

/** Each language in its own language, so a visitor can always find theirs. Not translated on purpose. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", id: "Bahasa Indonesia" };
