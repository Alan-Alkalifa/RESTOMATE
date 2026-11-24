import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DEFAULT_AFTER_LOGIN, getCurrentUser, safeNextPath } from "@/lib/auth";

/** First value of a query parameter (Next gives an array when it repeats). */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function linkErrorFrom(value: string | string[] | undefined) {
  const code = first(value);
  return code === "invalid_link" || code === "unavailable" ? code : undefined;
}

/**
 * Signed-in users skip the auth pages. Reads the session, so it must render inside `<Suspense>`.
 * An unreachable Auth (`"unavailable"`) does not redirect: the form still works.
 */
export async function SignedOutOnly({ next, children }: { next?: string; children: ReactNode }) {
  const user = await getCurrentUser();
  if (user && user !== "unavailable") redirect(safeNextPath(next, DEFAULT_AFTER_LOGIN));
  return children;
}
