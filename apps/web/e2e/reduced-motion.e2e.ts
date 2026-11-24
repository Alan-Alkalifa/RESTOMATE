import { expect, test, type Page } from "@playwright/test";

// DESIGN 4.5: with prefers-reduced-motion, movement goes and only opacity fades stay; the marketing page
// has no smooth scroll and no moving reveals. The `/dev` gallery (development and preview builds) has a
// modal, a sheet and a toast, so all three are checked.

type Sample = { key: string; transform: string; opacity: string };

/** Samples every frame for `ms` after `trigger`, for elements matching `selector` and their parents. */
async function sample(
  page: Page,
  selector: string,
  ms: number,
  trigger: () => Promise<void>,
): Promise<Sample[]> {
  const sampler = page.evaluate(
    ([sel, duration]) =>
      new Promise<Sample[]>((resolve) => {
        const out: Sample[] = [];
        const start = performance.now();
        const tick = () => {
          document.querySelectorAll(sel).forEach((el, index) => {
            let node: Element | null = el;
            for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
              const style = getComputedStyle(node);
              out.push({
                key: `${index}:${depth}`,
                transform: style.transform,
                opacity: style.opacity,
              });
            }
          });
          if (performance.now() - start < duration) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    [selector, ms] as const,
  );
  await trigger();
  return sampler;
}

/** For a failure message: which elements changed transform, and a few of the values. */
function movingDetail(samples: Sample[]): string {
  const seen = new Map<string, Set<string>>();
  for (const s of samples) seen.set(s.key, (seen.get(s.key) ?? new Set<string>()).add(s.transform));
  return JSON.stringify(
    [...seen].filter(([, v]) => v.size >= 3).map(([k, v]) => [k, [...v].slice(0, 4)]),
  );
}

/**
 * Movement is a transform that takes three or more values across frames: an eased animation passes through
 * many. A fixed transform (centering) has one, and with reduced motion Motion snaps an element from its
 * hidden offset to its final place in one step while it is still transparent: two values, no movement.
 */
function moves(samples: Sample[]): boolean {
  const seen = new Map<string, Set<string>>();
  for (const s of samples) {
    const values = seen.get(s.key) ?? new Set<string>();
    values.add(s.transform);
    seen.set(s.key, values);
  }
  return [...seen.values()].some((values) => values.size >= 3);
}

const SURFACES = [
  { name: "modal", button: "Open modal", selector: 'dialog, [role="dialog"]' },
  { name: "sheet", button: "Open sheet", selector: 'dialog, [role="dialog"]' },
  { name: "toast", button: "Success toast", selector: '[role="status"], [role="alert"]' },
] as const;

test.describe("reduced motion on", () => {
  test.use({ reducedMotion: "reduce" });

  for (const surface of SURFACES) {
    test(`${surface.name}: nothing moves, it only fades`, async ({ page }) => {
      await page.goto("/dev");
      const button = page.getByRole("button", { name: surface.button });
      await expect(button).toBeVisible({ timeout: 60_000 });
      const samples = await sample(page, surface.selector, 700, () => button.click());
      expect(samples.length, `no ${surface.name} frames were sampled`).toBeGreaterThan(0);
      expect(
        moves(samples),
        `${surface.name} moved with reduced motion: ${movingDetail(samples)}`,
      ).toBe(false);
    });
  }

  test("marketing page: no smooth scroll and no moving reveals", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await lenisTakesOverWheel(page), "Lenis is smoothing the wheel scroll").toBe(false);
    const state = await page.evaluate(() => ({
      inlineTransforms: document.querySelectorAll('main [style*="transform"]').length,
      hidden: [...document.querySelectorAll("main h1, main h2, main p")].filter(
        (el) => getComputedStyle(el).opacity === "0",
      ).length,
    }));
    expect(state.inlineTransforms, "elements a script left transformed").toBe(0);
    expect(state.hidden, "text still invisible after scrolling").toBe(0);
  });
});

/**
 * Whether Lenis takes over wheel scrolling. Lenis cancels a wheel event (preventDefault) when it is smoothing
 * the scroll, and leaves it alone when it honours reduced motion, so the answer does not depend on frame timing.
 */
async function lenisTakesOverWheel(page: Page): Promise<boolean> {
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const event = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

// Controls: without the preference the same checks must see movement, or the tests above prove nothing.
test.describe("reduced motion off (control)", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the modal moves when motion is allowed", async ({ page }) => {
    await page.goto("/dev");
    const button = page.getByRole("button", { name: "Open modal" });
    await expect(button).toBeVisible({ timeout: 60_000 });
    const samples = await sample(page, 'dialog, [role="dialog"]', 700, () => button.click());
    expect(moves(samples), "the control saw no movement, so the check cannot tell").toBe(true);
  });

  test("the marketing page smooth-scrolls when motion is allowed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await lenisTakesOverWheel(page),
      "the control saw no Lenis takeover, so the check cannot tell",
    ).toBe(true);
  });
});
