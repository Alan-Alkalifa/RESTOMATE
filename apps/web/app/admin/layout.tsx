import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getTranslate } from "@/components/i18n/server";
import { Unavailable } from "@/components/shell/notices";
import { signOut } from "@/lib/actions/auth/actions";
import { loginUrl, requirePlatformAdmin } from "@/lib/auth";
import { PlatformLoading, PlatformShell } from "./_components/platform-shell";

const ADMIN_PATH = "/admin";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslate();
  return {
    title: {
      default: t("platform.title"),
      template: `%s · ${t("platform.title")}`,
    },
    // The console is never indexed.
    robots: { index: false, follow: false },
  };
}

async function signOutAction() {
  "use server";
  await signOut();
}

/**
 * The super admin console. `requirePlatformAdmin` decides: signed out goes to login, a signed-in
 * person who is not listed gets a 404 (the console does not exist for them), and an outage shows the
 * error screen with retry. Nothing of the console renders before the check passes.
 */
async function Guarded({ children }: { children: ReactNode }) {
  const result = await requirePlatformAdmin();
  if (!result.ok) {
    switch (result.error.code) {
      case "unauthenticated":
        redirect(loginUrl(ADMIN_PATH));
      case "not_platform_admin":
        notFound();
      default:
        return <Unavailable />;
    }
  }
  return <PlatformShell signOutAction={signOutAction}>{children}</PlatformShell>;
}

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<PlatformLoading />}>
      <Guarded>{children}</Guarded>
    </Suspense>
  );
}
