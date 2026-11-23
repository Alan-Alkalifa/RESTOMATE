/**
 * Request-scoped signal from `proxy.ts` to the access layer: set (to "1") on the request headers
 * when the session refresh in this very request timed out or failed, meaning Auth is down right
 * now. `getCurrentUser` then answers "unavailable" at once instead of spending a second Auth
 * deadline. A client can never send it: `proxy.ts` removes it from every incoming request (like
 * the tenant header) before it decides whether to set it. No imports, so the proxy can use it.
 */
export const AUTH_DOWN_HEADER = "x-restomate-auth-down";
