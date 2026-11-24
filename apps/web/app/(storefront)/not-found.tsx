import { getTranslate } from "@/components/i18n/server";
import { Suspense } from "react";

async function Body() {
  const { t } = await getTranslate();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-2 px-page py-10">
      <h1 className="text-h2 text-text">{t("storefront.notfound.title")}</h1>
      <p className="text-body text-text-secondary">{t("storefront.notfound.description")}</p>
    </main>
  );
}

/** An unknown restaurant address. The proxy already answers 404 for an unknown host; this covers a known host with no such restaurant. */
export default function StorefrontNotFound() {
  return (
    <Suspense>
      <Body />
    </Suspense>
  );
}
