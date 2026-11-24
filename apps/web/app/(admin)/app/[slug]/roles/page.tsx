import { Suspense } from "react";
import { NoAccess } from "@/components/shell/notices";
import { listMembers } from "@/lib/actions/staff/actions";
import { getOrgContext } from "@/lib/auth";
import { RolesLoading, RolesUnavailable } from "./_components/states";
import { RolesScreen } from "./_components/roles-screen";
import { readRoles } from "./_lib/read";

/**
 * Roles: the permission checklist, built-in roles read-only, custom roles locked by package. Needs
 * `staff.manage`; a member without it sees a notice inside the shell, never a 404 (auth.md).
 */
async function Roles({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getOrgContext({ slug });
  if (!result.ok) return <RolesUnavailable />; // the layout already refused every other answer
  const { ctx } = result;
  if (!ctx.permissions.has("staff.manage")) return <NoAccess />;

  const members = await listMembers({ orgId: ctx.org.id });
  if (!members.ok) return <RolesUnavailable />;
  const counts = new Map<string, number>();
  for (const m of members.data.members) {
    if (m.status === "active") counts.set(m.roleId, (counts.get(m.roleId) ?? 0) + 1);
  }

  const roles = await readRoles(ctx.org.id, counts);
  if (!roles) return <RolesUnavailable />;

  return (
    <RolesScreen
      orgId={ctx.org.id}
      slug={ctx.org.slug}
      roles={roles}
      held={[...ctx.permissions]}
      canCustomize={ctx.package?.features.custom_roles === true}
    />
  );
}

export default function RolesPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<RolesLoading />}>
      <Roles params={params} />
    </Suspense>
  );
}
