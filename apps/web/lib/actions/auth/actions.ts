"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEFAULT_AFTER_LOGIN,
  LOGIN_PATH,
  UNAVAILABLE,
  fail,
  getCurrentUser,
  ok,
  type ActionResult,
} from "../../auth";
import {
  forgotPasswordSchema,
  loginSchema,
  readInput,
  resetPasswordSchema,
  signupSchema,
} from "./schemas";
import {
  authClient,
  authErrorResult,
  parseInput,
  protect,
  runAuth,
  skipIfSignedIn,
  statelessAuthClient,
} from "./shared";

/*
 * Auth Server Actions (M0-BE-20). Every one of them:
 *   1. parses its input with the shared Zod schema (a blank or malformed email never reaches Arcjet),
 *   2. is rate-limited by `protectAuth` BEFORE any Supabase call (all but `signOut`, which is never refused),
 *   3. returns one `ActionResult` (codes and message keys only, no text, no echoed input),
 *   4. redirects on success where the user should move on (login, reset, sign out).
 * `input` is a `FormData` or a plain object. With `useActionState`, wrap it:
 * `(_prev, formData) => login(formData)`.
 *
 * Email links are built by Supabase on the Site URL (never on the caller's host) and land on
 * `/auth/confirm` with a `token_hash` (see `app/auth/confirm/route.ts`).
 */

/** Sign in with email and password. Success redirects to a safe `next` (default `/app`). */
export async function login(input: unknown): Promise<ActionResult> {
  const parsed = parseInput(loginSchema, readInput(input));
  if (!parsed.ok) return parsed.result;
  const { email, password } = parsed.data;
  const destination = parsed.data.next ?? DEFAULT_AFTER_LOGIN;

  const refused = await protect("login", email);
  if (refused) return refused;
  await skipIfSignedIn(destination);

  const { supabase, guard } = await authClient();
  const outcome = await runAuth(guard, () => supabase.auth.signInWithPassword({ email, password }));
  if (outcome.status !== "done") return fail("unavailable");
  if (outcome.value.error) return authErrorResult(outcome.value.error);
  redirect(destination);
}

/**
 * Create an account. The answer is the same whether or not the address is already registered
 * (Supabase hides it), so the form can never be used to find out who has an account.
 * `ok({ status: "confirmation_sent" })` means "check your email"; a project with email
 * confirmation switched off signs the user in at once, and that redirects.
 */
export async function signup(
  input: unknown,
): Promise<ActionResult<{ status: "confirmation_sent" }>> {
  const parsed = parseInput(signupSchema, readInput(input));
  if (!parsed.ok) return parsed.result;
  const { email, password, fullName, locale } = parsed.data;
  const destination = parsed.data.next ?? DEFAULT_AFTER_LOGIN;

  const refused = await protect("signup", email);
  if (refused) return refused;
  await skipIfSignedIn(destination);

  // Cookie-free: the response's headers must not differ for an existing address (QA S3).
  const { supabase, guard } = statelessAuthClient();
  const outcome = await runAuth(guard, () =>
    supabase.auth.signUp({
      email,
      password,
      // Read by the `profiles` trigger. No `emailRedirectTo`: the link uses the Site URL.
      options: { data: { ...(fullName && { full_name: fullName }), locale: locale ?? "en" } },
    }),
  );
  if (outcome.status !== "done") return fail("unavailable");
  const { error } = outcome.value;
  // An address that already has a confirmed account must look exactly like a new one (QA S2):
  // the same `ok`, nothing else in the response, so the form can't tell who has an account.
  if (error && ACCOUNT_EXISTS.has(String((error as { code?: unknown }).code))) {
    return ok({ status: "confirmation_sent" as const });
  }
  if (error) return authErrorResult(error);
  const session = outcome.value.data.session;
  if (session) {
    // Only when the project has email confirmation switched off: sign in by writing the session
    // into the cookies through the normal client, then move on.
    const { supabase: cookieClient, guard: cookieGuard } = await authClient();
    await runAuth(cookieGuard, () =>
      cookieClient.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    );
    redirect(destination);
  }
  return ok({ status: "confirmation_sent" as const });
}

/** GoTrue's codes for "this address is already registered" (the name changed between versions). */
const ACCOUNT_EXISTS = new Set(["user_already_exists", "email_exists"]);

/**
 * Send a password-reset email. The answer does not say whether the address has an account:
 * only a rate limit or an outage is reported, anything else looks like success.
 */
export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = parseInput(forgotPasswordSchema, readInput(input));
  if (!parsed.ok) return parsed.result;
  const { email } = parsed.data;

  const refused = await protect("passwordReset", email);
  if (refused) return refused;
  await skipIfSignedIn(DEFAULT_AFTER_LOGIN);

  // Cookie-free, as signup: a known and an unknown address get the same headers (QA S3).
  const { supabase, guard } = statelessAuthClient();
  const outcome = await runAuth(guard, () => supabase.auth.resetPasswordForEmail(email));
  if (outcome.status !== "done") return fail("unavailable");
  if (outcome.value.error) {
    const result = authErrorResult(outcome.value.error);
    if (result.error.code === "rate_limited" || result.error.code === "unavailable") return result;
  }
  return ok();
}

/**
 * Choose a new password. The user is signed in by the recovery link (`/auth/confirm`), so this
 * needs a verified session, and then ends every other session of the account.
 */
export async function resetPassword(input: unknown): Promise<ActionResult> {
  const parsed = parseInput(resetPasswordSchema, readInput(input));
  if (!parsed.ok) return parsed.result;
  const { password } = parsed.data;

  // Rate-limited before the session is read (reading it can call Auth). Per IP only: the user is
  // already signed in by the link, and the login preset leaves room for typing mistakes.
  const refused = await protect("login");
  if (refused) return refused;
  const user = await getCurrentUser();
  if (user === UNAVAILABLE) return fail("unavailable");
  if (!user) return fail("unauthenticated");

  const { supabase, guard } = await authClient();
  const outcome = await runAuth(guard, () => supabase.auth.updateUser({ password }));
  if (outcome.status !== "done") return fail("unavailable");
  if (outcome.value.error) return authErrorResult(outcome.value.error);
  // Best effort: a stolen session must not outlive the reset. This one stays signed in.
  await runAuth(guard, () => supabase.auth.signOut({ scope: "others" }));
  redirect(DEFAULT_AFTER_LOGIN);
}

/**
 * Sign out of this session only (`scope: "local"`: the server revokes it, other devices stay
 * signed in) and clear its cookies, whether or not Auth could be reached. Redirects to login.
 *
 * Never rate-limited and never refused: a refused sign-out would leave a shared venue device
 * signed in (at a shift change, many staff sign out from one IP). There is nothing to guess
 * here, and Server Actions already get Next's origin check.
 */
export async function signOut(): Promise<ActionResult> {
  const { supabase, guard } = await authClient();
  await runAuth(guard, () => supabase.auth.signOut({ scope: "local" }));

  // `signOut` clears them when Auth answers; when it does not, the browser still forgets us.
  const store = await cookies();
  for (const { name } of store.getAll()) if (name.startsWith("sb-")) store.delete(name);
  redirect(LOGIN_PATH);
}
