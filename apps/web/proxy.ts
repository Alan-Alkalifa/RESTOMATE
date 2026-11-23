import { type NextRequest, NextResponse } from "next/server";
import { protectRequest } from "./lib/arcjet";
import { resolveHost } from "./lib/supabase/host";
import { updateSession } from "./lib/supabase/session";

/**
 * Host routing, abuse protection (Arcjet) and session refresh only. This file NEVER decides who
 * may do what: every page, action and route handler authorizes on the server, and RLS backs it.
 */

/** DOKU posts here. It carries no user session and no cookies; the proxy must not touch it. */
export const DOKU_WEBHOOK_PATH = "/api/webhooks/doku";

/** Set by this proxy for tenant hosts only; any value sent by a client is always removed. */
export const TENANT_HEADER = "x-restomate-tenant";

function isWebhook(pathname: string): boolean {
  return pathname === DOKU_WEBHOOK_PATH || pathname.startsWith(`${DOKU_WEBHOOK_PATH}/`);
}

export async function proxy(request: NextRequest) {
  if (isWebhook(request.nextUrl.pathname)) {
    // No host check, Arcjet or session refresh, but a client-sent tenant header never reaches it.
    const headers = new Headers(request.headers);
    headers.delete(TENANT_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  // `process.env.X` is read here at request time (a Vercel system variable is not a Next
  // public variable), and the host comes from the request, which Vercel sets.
  const resolved = resolveHost(request.headers.get("host"), {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    vercelBranchUrl: process.env.VERCEL_BRANCH_URL,
    lenient: process.env.NODE_ENV !== "production",
  });

  if (resolved.kind === "unknown") {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  // Abuse protection (shield, bots), never authorization. Tenant hosts get shield only.
  const verdict = await protectRequest(request, resolved.kind === "tenant" ? "tenant" : "app");
  if (!verdict.allow) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain" },
    });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TENANT_HEADER);
  if (resolved.kind === "tenant" && resolved.slug) {
    // Guests only: no session to refresh on a customer site.
    requestHeaders.set(TENANT_HEADER, resolved.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return updateSession(request, requestHeaders);
}

export const config = {
  // Everything except Next internals and static files. The webhook is also skipped in code.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
