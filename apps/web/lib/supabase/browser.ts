import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Public key only; RLS applies.
 *
 * This file must not import `lib/env`: that module names the server secrets, and anything a
 * client component imports ends up in the browser bundle. Next inlines only a literal
 * public variable read, so the values are read out one by one.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
  ].filter(Boolean);
  if (!url || !publishableKey) {
    throw new Error(`[env] Invalid Supabase environment: ${missing.join(", ")} (is required)`);
  }
  return createBrowserClient(url, publishableKey);
}
