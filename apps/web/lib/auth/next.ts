export const LOGIN_PATH = "/login";
export const DEFAULT_AFTER_LOGIN = "/app";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
/** Where a recovery link lands (signed in by the link, to choose a new password). */
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * A `next` value is user input. Only a same-site absolute path is kept: it starts with one "/",
 * not "//" or "/\", has no scheme, backslash or control character, and is short. Anything else
 * becomes the fallback. M0-BE-20 uses this too.
 */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  // A path that decodes into "//host" or a backslash is the same trick, encoded.
  if (
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /^\/+[a-z][a-z0-9+.-]*:/i.test(decoded)
  ) {
    return fallback;
  }
  return raw;
}

/** `/login?next=<safe path>`; no `next` when it is the default. */
export function loginUrl(next?: unknown): string {
  const safe = safeNextPath(next, "");
  return safe && safe !== "/" ? `${LOGIN_PATH}?next=${encodeURIComponent(safe)}` : LOGIN_PATH;
}
