// Test users and organizations, created through Supabase's own APIs so a journey can start
// signed out with data already in place. The service-role key stays in the test process;
// it never reaches the browser.

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = () =>
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";
const service = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const TEST_PASSWORD = "Qa-Test-Passw0rd!";

/** Unique per run, so a retry or a second project never collides with an earlier user or slug. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${body.slice(0, 200)}`);
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

/** A confirmed user with a known password. */
export async function createUser(email: string): Promise<{ id: string; email: string }> {
  const res = await fetch(`${url()}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: service(),
      authorization: `Bearer ${service()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: TEST_PASSWORD, email_confirm: true }),
  });
  const user = await json(res, "create user");
  return { id: String(user.id), email };
}

async function accessToken(email: string): Promise<string> {
  const res = await fetch(`${url()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon(), "content-type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return String((await json(res, "sign in")).access_token);
}

/** Creates a restaurant as `email` through the same RPC the app uses. */
export async function createOrganizationAs(
  email: string,
  name: string,
  slug: string,
): Promise<void> {
  const token = await accessToken(email);
  const res = await fetch(`${url()}/rest/v1/rpc/create_organization`, {
    method: "POST",
    headers: {
      apikey: anon(),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_name: name,
      p_slug: slug,
      p_timezone: "Asia/Jakarta",
      p_location_name: "Main",
      p_address: null,
      p_tax_bps: 0,
      p_service_charge_bps: 0,
      p_tax_on_service: false,
    }),
  });
  await json(res, "create organization");
}

/**
 * Invites `inviteeEmail` into `slug` as a Cashier, as the owner, through the same RPC the app uses, with a
 * token the test knows. The app's own invitation email is not readable locally (EMAIL_DELIVERY=log records
 * no body or link), so acceptance is driven from this link.
 */
export async function inviteCashierWithToken(
  ownerEmail: string,
  slug: string,
  inviteeEmail: string,
  token: string,
): Promise<void> {
  const access = await accessToken(ownerEmail);
  const headers = {
    apikey: anon(),
    authorization: `Bearer ${access}`,
    "content-type": "application/json",
  };
  const rest = (path: string) => `${url()}/rest/v1/${path}`;
  const [org] = (await (
    await fetch(rest(`organizations?slug=eq.${slug}&select=id`), { headers })
  ).json()) as Array<{ id: string }>;
  const [role] = (await (
    await fetch(rest(`roles?org_id=eq.${org.id}&system_key=eq.cashier&select=id`), { headers })
  ).json()) as Array<{ id: string }>;
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  ).toString("hex");
  const res = await fetch(rest("rpc/create_staff_invitation"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_org_id: org.id,
      p_email: inviteeEmail,
      p_role_id: role.id,
      p_token_hash: `\\x${hash}`,
      p_all_locations: true,
      p_location_ids: null,
    }),
  });
  await json(res, "create staff invitation");
}
