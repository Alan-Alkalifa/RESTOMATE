"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/components/i18n/provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { acceptInvitation } from "@/lib/actions/staff/actions";
import { InviteInvalid } from "./chrome";

/** The invitation is real and open. Names only: never an email, an id or the locations. */
function Heading({ orgName, roleName }: { orgName: string; roleName: string }) {
  const { t } = useI18n();
  return (
    <>
      <h1 className="text-h2 text-text">{t("staff.invite_page.title", { org: orgName })}</h1>
      <p className="text-body text-text-secondary">
        {t("staff.invite_page.role", { role: roleName })}
      </p>
    </>
  );
}

/** Signed out: sign in or create an account, and come back to this link. */
export function SignedOutCard({
  orgName,
  roleName,
  next,
}: {
  orgName: string;
  roleName: string;
  next: string;
}) {
  const { t } = useI18n();
  const query = `?next=${encodeURIComponent(next)}`;
  return (
    <Card className="flex flex-col gap-4">
      <Heading orgName={orgName} roleName={roleName} />
      <p className="text-body-sm text-text-secondary">{t("staff.invite_page.signed_out")}</p>
      <div className="flex flex-wrap gap-3">
        <Link href={`/login${query}`} className={buttonClasses({ variant: "primary" })}>
          {t("staff.invite_page.signin")}
        </Link>
        <Link href={`/signup${query}`} className={buttonClasses({ variant: "outline" })}>
          {t("staff.invite_page.signup")}
        </Link>
      </div>
    </Card>
  );
}

/** Signed in: one button. Every refusal that means "this link is no good" shows the generic page. */
export function AcceptCard({
  token,
  orgName,
  roleName,
}: {
  token: string;
  orgName: string;
  roleName: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bad, setBad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (bad) return <InviteInvalid />;

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation({ token });
      if (result.ok) {
        router.replace(`/app/${encodeURIComponent(result.data.slug)}`);
        return;
      }
      switch (result.error.code) {
        case "conflict": // already a member of this restaurant
          router.replace("/app");
          return;
        case "unauthenticated":
          router.refresh();
          return;
        case "unavailable":
        case "unknown":
        case "rate_limited":
          setError(t(`error.${result.error.code}`));
          return;
        default: // invalid_token, the wrong address, anything else: the same page
          setBad(true);
      }
    });
  }

  return (
    <Card className="flex flex-col gap-4">
      <Heading orgName={orgName} roleName={roleName} />
      {error && (
        <p role="alert" className="rounded-md bg-danger-50 p-3 text-body-sm text-danger-700">
          {error}
        </p>
      )}
      <Button className="self-start" loading={pending} onClick={accept}>
        {t("staff.invite_page.accept")}
      </Button>
    </Card>
  );
}
