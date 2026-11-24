import "server-only";
import { cookies, headers } from "next/headers";
import { messages } from "@/messages";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locale";
import { createTranslate, type Translate } from "./translate";

/**
 * The language of this request. It reads cookies and headers, so call it only inside `<Suspense>`
 * (Cache Components): never in a `'use cache'` function, and never put it in a cache key.
 */
export async function getLocale(): Promise<Locale> {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, list.get("accept-language"));
}

/** `const t = await getTranslate()` in a Server Component. */
export async function getTranslate(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: createTranslate(locale, messages[locale]) };
}
