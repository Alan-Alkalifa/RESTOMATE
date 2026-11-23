/**
 * Invitation tokens (S4 from M0-BE-09 QA). The raw token is 32 random bytes encoded base64url:
 * 43 characters, so it can never be mistaken for, or fit into, the 32-byte `token_hash` column.
 * Only `sha256(utf8(token))` is stored; the raw token exists in the email link and nowhere else
 * (never logged, never in a cache key or event). `accept_invitation` hashes it the same way.
 */

export const TOKEN_BYTES = 32;
export const TOKEN_LENGTH = 43; // base64url of 32 bytes, no padding
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of the token's UTF-8 bytes: what the database stores and compares. */
export async function hashToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

/** A `bytea` value for PostgREST: `\x` and lower-case hex. */
export function toBytea(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type InvitationToken = {
  /** For the email link only. */
  token: string;
  /** For the database only (`\x...`). */
  tokenHash: string;
};

export async function newInvitationToken(): Promise<InvitationToken> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  return { token, tokenHash: toBytea(await hashToken(token)) };
}
