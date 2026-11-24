import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslate } from "@/components/i18n/server";

/** The customer site: guests only, native scroll (no Lenis, no GSAP). Its own title template. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslate();
  return { title: { default: t("storefront.title"), template: `%s · ${t("storefront.title")}` } };
}

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-dominant-50">{children}</div>;
}
