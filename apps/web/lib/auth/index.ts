/**
 * Access layer (M0-BE-15). These functions are the ONLY way server code checks who someone is and
 * what they may do. Pages, Server Actions and route handlers call them; nothing else reads the
 * session, `organization_members`, roles or `platform_admins` to decide access. `proxy.ts` never
 * authorizes, and RLS is the second line behind these.
 *
 *   getCurrentUser()                 the verified user, null (no session) or "unavailable" (Auth
 *                                    unreachable; cached privately; inside <Suspense>)
 *   requireUser({ next })            the user, or redirect to /login?next=<safe path>; throws
 *                                    AuthUnavailableError on an outage (no redirect)
 *   getMembership(userId, ref)       active member of an active org, or the reason it is not
 *   getOrgContext(ref)               user + org + member + permissions + package, or a reason
 *   hasPermission / requirePermission(ctx, key)   `requirePermission` returns an ActionResult
 *   hasFeature / requireFeature(ctx, key)         the org's package features
 *   requirePlatformAdmin()           service-role check of platform_admins
 *   refreshMemberAccess / refreshOrgPackage       updateTag, from the action that changed it
 *
 * An action: `const r = await getOrgContext({ slug }); if (!r.ok) return fail(r.reason);` then
 * `const denied = requirePermission(r.ctx, "staff.manage"); if (!denied.ok) return denied;`.
 * A page shows the suspended notice for `org_suspended` and a 404 for `no_membership`.
 * Cache tags and keys hold IDs only.
 */
export * from "./result";
export * from "./keys";
export {
  LOGIN_PATH,
  DEFAULT_AFTER_LOGIN,
  FORGOT_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
  loginUrl,
  safeNextPath,
} from "./next";
export { isAuthOutage } from "./transport";
export {
  type AuthUser,
  type CurrentUser,
  AuthUnavailableError,
  UNAVAILABLE,
  getCurrentUser,
  requireUser,
} from "./user";
export {
  type Membership,
  type MembershipResult,
  type OrgContext,
  type OrgContextResult,
  type OrgPackage,
  type OrgRef,
  getMembership,
  getOrgContext,
  hasFeature,
  hasPermission,
  refreshMemberAccess,
  refreshOrgPackage,
  requireFeature,
  requirePermission,
} from "./org";
export { requirePlatformAdmin } from "./platform";
