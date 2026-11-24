"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Messages } from "@/messages";
import { formatDate, formatNumber, type DateStyle } from "./format";
import type { Locale } from "./locale";
import { createTranslate, type Translate } from "./translate";

type I18n = {
  locale: Locale;
  t: Translate;
  number: (value: number) => string;
  date: (value: Date | string | number, timeZone: string, style?: DateStyle) => string;
};

const Ctx = createContext<I18n | null>(null);

/** Gives client components the language and its messages. The server picks them (`getTranslate`). */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo<I18n>(
    () => ({
      locale,
      t: createTranslate(locale, messages),
      number: (n) => formatNumber(n, locale),
      date: (v, tz, style) => formatDate(v, locale, tz, style),
    }),
    [locale, messages],
  );
  // The static root layout renders `<html lang="en">`; this makes it follow the chosen language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `const { t, locale, number, date } = useI18n()`. */
export function useI18n(): I18n {
  const value = useContext(Ctx);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
