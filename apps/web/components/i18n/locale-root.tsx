import { Suspense, type ReactNode } from "react";
import { messages } from "@/messages";
import { getLocale } from "./server";
import { I18nProvider } from "./provider";

async function Resolved({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <I18nProvider locale={locale} messages={messages[locale]}>
      {children}
    </I18nProvider>
  );
}

/** Reads the language inside a Suspense boundary (the layout itself stays static). Wrap `{children}` once, in the root layout. */
export function LocaleRoot({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Resolved>{children}</Resolved>
    </Suspense>
  );
}
