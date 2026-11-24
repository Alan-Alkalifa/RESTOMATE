import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslate } from "@/components/i18n/server";
import { MarketingFooter, MarketingHeader } from "./_components/chrome";
import { SmoothScroll } from "./_components/smooth-scroll";

/** The public site on the root domain. Its own title template; the only surface with Lenis and GSAP. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslate();
  return {
    title: { default: t("meta.title"), template: `%s · ${t("auth.screen.brand")}` },
  };
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SmoothScroll />
      <div className="flex min-h-dvh flex-col bg-dominant-50">
        <MarketingHeader />
        <main className="flex-1">{children}</main>
        <MarketingFooter />
      </div>
    </>
  );
}
