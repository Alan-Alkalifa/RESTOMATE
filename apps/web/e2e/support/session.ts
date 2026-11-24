import type { BrowserContext } from "@playwright/test";

// The Supabase session lives in a cookie (`sb-<ref>-auth-token`, split into `.0`, `.1` chunks when long)
// holding `base64-` plus base64url JSON. Tests read it to prove what a revoked session can still do.

export type StoredSession = { access_token: string; refresh_token: string };

export async function readSession(context: BrowserContext): Promise<StoredSession> {
  const cookies = (await context.cookies()).filter((c) =>
    /^sb-.*-auth-token(\.\d+)?$/.test(c.name),
  );
  if (cookies.length === 0) throw new Error("No Supabase session cookie in this browser context");
  const joined = cookies
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((c) => decodeURIComponent(c.value))
    .join("");
  const raw = joined.startsWith("base64-")
    ? Buffer.from(joined.slice(7), "base64url").toString("utf8")
    : joined;
  const parsed = JSON.parse(raw) as StoredSession;
  if (!parsed.access_token || !parsed.refresh_token)
    throw new Error("Session cookie has no tokens");
  return parsed;
}
