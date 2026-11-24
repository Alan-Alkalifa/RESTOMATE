import { execFileSync } from "node:child_process";

// A few things the app cannot do yet (a plan change and a suspension are platform actions that arrive in M1)
// are done as the database owner, through the local Supabase container. Without Docker the caller skips.

export function psql(sql: string): boolean {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "supabase_db_restomate",
        "psql",
        "-U",
        "postgres",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ],
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Moves the restaurant to a plan (`growth` has custom roles and three locations). */
export function setPlan(slug: string, planKey: string): boolean {
  return psql(
    `update public.subscriptions set package_id = (select id from public.packages where key = '${planKey}') where org_id = (select id from public.organizations where slug = '${slug}')`,
  );
}

export function suspendOrganization(slug: string): boolean {
  return psql(`update public.organizations set status = 'suspended' where slug = '${slug}'`);
}
