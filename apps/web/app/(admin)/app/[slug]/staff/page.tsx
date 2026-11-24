import { Suspense } from "react";
import { NoAccess } from "@/components/shell/notices";
import { listLocations } from "@/lib/actions/organization/actions";
import { listInvitations, listMembers } from "@/lib/actions/staff/actions";
import { getOrgContext } from "@/lib/auth";
import { readRoles } from "./_lib/roles";
import { StaffLoading, StaffUnavailable } from "./_components/states";
import { StaffScreen } from "./_components/staff-screen";

const FALLBACK_TIMEZONE = "Asia/Jakarta";

/** Staff: members, pending invitations, invite, role and location edit, deactivate. */
async function Staff({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getOrgContext({ slug });
  // The layout already refused every other answer. A member without the permission sees a notice
  // inside the shell, never a 404 (auth.md).
  if (!result.ok) return <StaffUnavailable />;
  const { ctx } = result;
  if (!ctx.permissions.has("staff.manage")) return <NoAccess />;

  const [members, invitations, locations, roles] = await Promise.all([
    listMembers({ orgId: ctx.org.id }),
    listInvitations({ orgId: ctx.org.id }),
    listLocations({ orgId: ctx.org.id }),
    readRoles(ctx.org.id),
  ]);
  if (!members.ok || !invitations.ok || !locations.ok || !roles) return <StaffUnavailable />;

  return (
    <StaffScreen
      orgId={ctx.org.id}
      members={members.data.members}
      invitations={invitations.data.invitations}
      roles={roles}
      locations={locations.data.locations.map(({ id, name }) => ({ id, name }))}
      maxStaff={ctx.package ? ctx.package.max_staff : 0}
      timeZone={locations.data.locations[0]?.timezone ?? FALLBACK_TIMEZONE}
    />
  );
}

export default function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<StaffLoading />}>
      <Staff params={params} />
    </Suspense>
  );
}
