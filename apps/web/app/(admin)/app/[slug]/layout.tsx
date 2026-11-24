import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/shell/admin-shell";
import { visibleNav } from "@/components/shell/nav";
import { OrgNotice, ShellLoading, Unavailable } from "@/components/shell/notices";
import { signOut } from "@/lib/actions/auth/actions";
import { listLocations } from "@/lib/actions/organization/actions";
import { getOrgContext, loginUrl } from "@/lib/auth";

async function signOutAction() {
  "use server";
  await signOut();
}

/**
 * Every page of a restaurant. The answer of `getOrgContext` picks the screen (auth.md): login,
 * 404, suspended, access removed or the error screen. Only then is the shell built, with the
 * navigation this member may see. A page still checks its own permission.
 */
async function ShellFor({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  const { slug } = await params;
  const result = await getOrgContext({ slug });
  if (!result.ok) {
    switch (result.reason) {
      case "unauthenticated":
        redirect(loginUrl(`/app/${encodeURIComponent(slug)}`));
      case "no_membership":
        notFound();
      case "org_suspended":
        return <OrgNotice kind="suspended" />;
      case "member_deactivated":
        return <OrgNotice kind="removed" />;
      default:
        return <Unavailable />;
    }
  }
  const { ctx } = result;
  const locations = await listLocations({ orgId: ctx.org.id });
  return (
    <AdminShell
      org={{ name: ctx.org.name, slug: ctx.org.slug }}
      user={{ email: ctx.user.email, roleName: ctx.member.roleName }}
      nav={visibleNav(ctx.org.slug, (p) => ctx.permissions.has(p))}
      locations={locations.ok ? locations.data.locations.map(({ id, name }) => ({ id, name })) : []}
      signOutAction={signOutAction}
    >
      {children}
    </AdminShell>
  );
}

export default function OrgLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={<ShellLoading />}>
      <ShellFor params={params}>{children}</ShellFor>
    </Suspense>
  );
}
