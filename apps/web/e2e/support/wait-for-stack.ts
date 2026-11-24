// `supabase db reset` (CLI 3.2.0) returns before Auth, Storage and Realtime are healthy again; they
// become healthy within about 60 s. Anything that signs up, signs in or sends mail waits here first.

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const mailpitUrl = () => process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

async function ok(url: string, headers: Record<string, string> = {}): Promise<boolean> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForStack(timeoutMs = 90_000): Promise<void> {
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const checks: Array<[string, string, Record<string, string>]> = [
    ["auth", `${supabaseUrl()}/auth/v1/health`, { apikey: anon }],
    ["rest", `${supabaseUrl()}/rest/v1/`, { apikey: anon }],
    ["mailpit", `${mailpitUrl()}/api/v1/info`, {}],
  ];
  const deadline = Date.now() + timeoutMs;
  let pending = checks.map(([name]) => name);
  while (Date.now() < deadline) {
    const results = await Promise.all(checks.map(([, url, headers]) => ok(url, headers)));
    pending = checks.filter((_, i) => !results[i]).map(([name]) => name);
    if (pending.length === 0) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `Local stack not healthy after ${timeoutMs / 1000}s: ${pending.join(", ")}. Run pnpm db:start and pnpm db:reset.`,
  );
}
