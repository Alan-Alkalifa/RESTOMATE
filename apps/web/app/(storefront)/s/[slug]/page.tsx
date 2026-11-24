import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getTranslate } from "@/components/i18n/server";
import { Card } from "@/components/ui/card";
import { createStatelessAuthClient } from "@/lib/supabase/stateless";

// The same shape the proxy and the database accept for an address (3 to 40, no "--").
const SLUG = /^(?!.*--)[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

type Storefront =
  | { suspended: true }
  | { suspended: false; name: string; locations: { id: string; name: string }[] };

/** `get_storefront` is the only read: public, no session, no ids, a suspended org returns only the flag. */
async function readStorefront(slug: string): Promise<Storefront | null> {
  if (!SLUG.test(slug)) return null;
  const { data, error } = await createStatelessAuthClient().rpc("get_storefront", { p_slug: slug });
  if (error) throw new Error("storefront_unavailable");
  const row = data as {
    suspended?: boolean;
    name?: string;
    locations?: { id: string; name: string }[];
  } | null;
  if (!row) return null;
  if (row.suspended) return { suspended: true };
  if (typeof row.name !== "string") return null;
  return { suspended: false, name: row.name, locations: row.locations ?? [] };
}

async function Placeholder({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ t }, shop] = await Promise.all([getTranslate(), readStorefront(slug)]);
  if (!shop) notFound();
  if (shop.suspended) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-page py-10">
        <Card role="status" className="flex flex-col gap-2">
          <h1 className="text-h2 text-text">{t("storefront.suspended.title")}</h1>
          <p className="text-body text-text-secondary">{t("storefront.suspended.description")}</p>
        </Card>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-3 px-page py-10">
      <h1 className="text-h1 text-text">{shop.name}</h1>
      <p className="text-body text-text-secondary">{t("storefront.placeholder")}</p>
    </main>
  );
}

export default function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<span className="skeleton m-6 block h-8 w-1/3 rounded-md" />}>
      <Placeholder params={params} />
    </Suspense>
  );
}
