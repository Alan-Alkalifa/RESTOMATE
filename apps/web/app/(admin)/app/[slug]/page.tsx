import { Suspense } from "react";
import { getTranslate } from "@/components/i18n/server";
import { Card } from "@/components/ui/card";
import { getOrgContext } from "@/lib/auth";

async function Home({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ t }, result] = await Promise.all([getTranslate(), getOrgContext({ slug })]);
  // The layout already refused every other answer.
  const name = result.ok ? result.ctx.org.name : "";
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1 text-text">{t("admin.home.title", { name })}</h1>
      <Card>
        <p className="text-body text-text-secondary">{t("admin.home.description")}</p>
      </Card>
    </div>
  );
}

export default function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<span className="skeleton block h-8 w-1/3 rounded-md" />}>
      <Home params={params} />
    </Suspense>
  );
}
