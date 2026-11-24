import { getTranslate } from "@/components/i18n/server";
import { Card } from "@/components/ui/card";
import { Suspense } from "react";

async function Overview() {
  const { t } = await getTranslate();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1 text-text">{t("platform.overview.title")}</h1>
      <Card>
        <p className="text-body text-text-secondary">{t("platform.overview.description")}</p>
      </Card>
    </div>
  );
}

export default function PlatformHomePage() {
  return (
    <Suspense fallback={<span className="skeleton block h-8 w-1/3 rounded-md" />}>
      <Overview />
    </Suspense>
  );
}
