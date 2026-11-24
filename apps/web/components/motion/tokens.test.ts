import { describe, expect, it } from "vitest";
import { duration, ease, PRESS_SCALE } from "./tokens";

describe("motion tokens (DESIGN.md §4.5)", () => {
  it("uses 150, 200 and 250 ms", () => {
    expect([duration.fast, duration.base, duration.slow]).toEqual([0.15, 0.2, 0.25]);
  });
  it("enters with ease-out and leaves with ease-in", () => {
    expect(ease.out).toEqual([0, 0, 0.2, 1]);
    expect(ease.in).toEqual([0.4, 0, 1, 1]);
  });
  it("presses to 0.98", () => expect(PRESS_SCALE).toBe(0.98));
});
