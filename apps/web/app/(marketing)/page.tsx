import Link from "next/link";
import { getTranslate } from "@/components/i18n/server";
import { buttonClasses } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Suspense } from "react";
import { Reveal } from "./_components/reveal";

const FEATURES = ["pos", "kitchen", "site"] as const;

async function Home() {
  const { t } = await getTranslate();
  return (
    <>
      {/* The first screen is plain server-rendered HTML: nothing waits for a script. */}
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-page py-20 text-center md:px-page-md">
        <h1 className="text-display text-text">{t("marketing.hero.title")}</h1>
        <p className="max-w-2xl text-body-lg text-text-secondary">{t("marketing.hero.subtitle")}</p>
        <Link href="/signup" className={buttonClasses({ variant: "spotlight", size: "lg" })}>
          {t("marketing.hero.cta")}
        </Link>
      </section>
      <section
        aria-labelledby="features-title"
        className="mx-auto w-full max-w-7xl px-page pb-20 md:px-page-md lg:px-page-lg"
      >
        <h2 id="features-title" className="mb-6 text-h2 text-text">
          {t("marketing.features.title")}
        </h2>
        <Reveal className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((id) => (
            <Card key={id} className="flex flex-col gap-2">
              <h3 className="text-h3 text-text">{t(`marketing.features.${id}.title`)}</h3>
              <p className="text-body text-text-secondary">
                {t(`marketing.features.${id}.description`)}
              </p>
            </Card>
          ))}
        </Reveal>
      </section>
    </>
  );
}

export default function MarketingHomePage() {
  return (
    <Suspense fallback={<div className="min-h-96" />}>
      <Home />
    </Suspense>
  );
}
