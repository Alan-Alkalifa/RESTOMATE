import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTranslate } from "@/components/i18n/server";
import { OrgNotice, ShellLoading, Unavailable } from "@/components/shell/notices";
import { buttonClasses } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { listMyOrganizations } from "@/lib/actions/organization/actions";
import { loginUrl } from "@/lib/auth";

const APP_PATH = "/app";

/**
 * Where `/app` leads: no restaurant, create one; one that works, go in; otherwise pick. A suspended
 * restaurant or a removed membership shows its notice instead of the restaurant's pages.
 */
async function Entry() {
  const result = await listMyOrganizations();
  if (!result.ok) {
    if (result.error.code === "unauthenticated") redirect(loginUrl(APP_PATH));
    return <Unavailable />;
  }
  const { organizations, atCap } = result.data;
  if (organizations.length === 0) redirect("/create-restaurant");

  const usable = (o: (typeof organizations)[number]) =>
    o.orgStatus === "active" && o.memberStatus === "active";

  if (organizations.length === 1) {
    const [only] = organizations;
    if (usable(only)) redirect(`/app/${encodeURIComponent(only.slug)}`);
    return <OrgNotice kind={only.orgStatus === "suspended" ? "suspended" : "removed"} />;
  }

  const { t } = await getTranslate();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-page py-10">
      <h1 className="text-h2 text-text">{t("admin.pick.title")}</h1>
      <ul className="flex flex-col gap-3">
        {organizations.map((o) => (
          <li key={o.orgId}>
            {usable(o) ? (
              <Link href={`/app/${encodeURIComponent(o.slug)}`} className="block">
                <Card interactive className="flex flex-col gap-1">
                  <span className="text-body font-semibold text-text">{o.name}</span>
                  <span className="text-body-sm text-text-secondary">{o.roleName}</span>
                </Card>
              </Link>
            ) : (
              <Card className="flex flex-col gap-1 opacity-80">
                <span className="text-body font-semibold text-text">{o.name}</span>
                <span className="text-body-sm text-text-secondary">
                  {o.orgStatus === "suspended"
                    ? t("admin.pick.suspended")
                    : t("admin.pick.removed")}
                </span>
              </Card>
            )}
          </li>
        ))}
      </ul>
      {!atCap && (
        <Link
          href="/create-restaurant"
          className={buttonClasses({ variant: "soft", className: "self-start" })}
        >
          {t("admin.pick.create")}
        </Link>
      )}
    </main>
  );
}

export default function AppEntryPage() {
  return (
    <Suspense fallback={<ShellLoading />}>
      <Entry />
    </Suspense>
  );
}
