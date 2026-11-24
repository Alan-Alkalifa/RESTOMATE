"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/provider";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";

/** A signed-in member without the permission a page needs. Shown inside the shell, never a 404. */
export function NoAccess() {
  const { t } = useI18n();
  return (
    <Card role="status" className="flex max-w-xl flex-col gap-3">
      <h1 className="text-h2 text-text">{t("admin.noaccess.title")}</h1>
      <p className="text-body text-text-secondary">{t("admin.noaccess.description")}</p>
    </Card>
  );
}

/** Full-page notices for an org that is suspended or a member whose access was removed. No org data. */
export function OrgNotice({ kind }: { kind: "suspended" | "removed" }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-page py-10">
      <Card role="status" className="flex flex-col gap-3">
        <h1 className="text-h2 text-text">{t(`admin.notice.${kind}.title`)}</h1>
        <p className="text-body text-text-secondary">{t(`admin.notice.${kind}.description`)}</p>
        <Link
          href="/app"
          className={buttonClasses({ variant: "primary", className: "self-start" })}
        >
          {t("admin.notice.back")}
        </Link>
      </Card>
    </div>
  );
}

/** The service could not be reached. Nothing changed; offer a retry, never a login redirect. */
export function Unavailable() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-page py-10">
      <ErrorState
        title={t("error.unavailable")}
        retryLabel={t("common.retry")}
        onRetry={() => router.refresh()}
      />
    </div>
  );
}

/** An error boundary body: the page failed to render. Never shows the error text. */
export function PageError({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-10">
      <ErrorState
        title={t("common.error.title")}
        description={t("error.unknown")}
        retryLabel={t("common.retry")}
        onRetry={reset}
      />
    </div>
  );
}

export function NotFoundNotice() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-xl flex-col justify-center gap-3 px-page py-10">
      <h1 className="text-h2 text-text">{t("admin.notfound.title")}</h1>
      <p className="text-body text-text-secondary">{t("error.no_membership")}</p>
      <Link href="/app" className={buttonClasses({ variant: "primary", className: "self-start" })}>
        {t("admin.notice.back")}
      </Link>
    </div>
  );
}

export function ShellLoading() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" aria-label={t("common.loading")} className="flex min-h-dvh">
      <span className="hidden w-64 bg-nav-bg lg:block" />
      <div className="flex flex-1 flex-col" aria-hidden="true">
        <span className="h-16 border-b border-border bg-surface" />
        <div className="flex flex-col gap-4 p-page md:p-page-md">
          <span className="skeleton h-8 w-1/3 rounded-md" />
          <span className="skeleton h-32 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
