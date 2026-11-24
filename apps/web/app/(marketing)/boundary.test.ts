import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * DESIGN.md §4.5.1: GSAP and Lenis load only in the marketing route group. A static import check:
 * no file outside `app/(marketing)` may import them. Together with the build's chunk list in the PR,
 * this is what keeps them out of the admin, super admin, POS, auth, onboarding and storefront bundles.
 */
const ROOT = join(__dirname, "..", "..");
const BANNED =
  /from\s+["'](gsap|@gsap\/react|lenis)(\/[^"']*)?["']|import\s+["'](gsap|lenis)[^"']*["']/;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx|css)$/.test(name)) yield path;
  }
}

describe("GSAP and Lenis stay in the marketing route group", () => {
  const dirs = ["app", "components", "lib"].map((d) => join(ROOT, d));
  const offenders = dirs
    .flatMap((d) => [...sources(d)])
    .filter((f) => !relative(ROOT, f).startsWith(`app${sep}(marketing)${sep}`))
    .filter((f) => !f.endsWith("boundary.test.ts"))
    .filter((f) => BANNED.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));

  it("has no import outside app/(marketing)", () => expect(offenders).toEqual([]));

  it("does have them inside, so the check is looking at the right place", () => {
    const inside = [...sources(join(ROOT, "app", "(marketing)"))].filter((f) =>
      BANNED.test(readFileSync(f, "utf8")),
    );
    expect(inside.length).toBeGreaterThan(0);
  });
});
