/** Normalizes an email so case and Unicode forms of one address share one rate-limit key. */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/**
 * A rate-limit key for an email: HMAC-SHA256 (hex) of `<scope>:<normalized email>`, keyed with a
 * server secret. The raw address never goes into a key, a log or an event, and without the secret
 * a key can't be matched to an address. The scope keeps one preset's count apart from another's.
 */
export async function emailKey(scope: string, email: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${scope}:${normalizeEmail(email)}`),
  );
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A rate-limit key for a user ID: HMAC-SHA256 (hex) of `<scope>:<id>`, keyed with a server
 * secret, so Arcjet never sees the raw ID and one preset's count stays apart from another's.
 */
export async function userKey(scope: string, userId: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${scope}:${userId}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}
