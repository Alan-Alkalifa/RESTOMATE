import { Suspense } from "react";
import { previewInvitation } from "@/lib/actions/staff/actions";
import { TOKEN_PATTERN } from "@/lib/actions/staff/tokens";
import { getCurrentUser } from "@/lib/auth";
import { InviteInvalid, InviteLoading, InviteUnavailable } from "./_components/chrome";
import { AcceptCard, SignedOutCard } from "./_components/join-card";

/**
 * `/invite/accept?token=...` from the invitation email. The same generic page answers a missing or
 * malformed token, an unknown, used, revoked or expired invitation and a suspended restaurant. The
 * token is only ever read here and passed on; it is not logged or shown.
 */
async function Accept({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return <InviteInvalid />;

  const preview = await previewInvitation({ token });
  // Rate limits, a blocked bot and a failed lookup are not a bad link: retry makes sense.
  if (!preview.ok) return <InviteUnavailable />;
  if (preview.data.status !== "open") return <InviteInvalid />;

  const user = await getCurrentUser();
  if (user === "unavailable") return <InviteUnavailable />;
  const { orgName, roleName } = preview.data;
  if (!user) {
    return (
      <SignedOutCard orgName={orgName} roleName={roleName} next={`/invite/accept?token=${token}`} />
    );
  }
  return <AcceptCard token={token} orgName={orgName} roleName={roleName} />;
}

export default function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<InviteLoading />}>
      <Accept searchParams={searchParams} />
    </Suspense>
  );
}
