import { describe, expect, it } from "vitest";

import { calculateTotals, formatMoney, type TotalsInput } from ".";
import { roundHalfUp } from "./rounding";

const MAX = Number.MAX_SAFE_INTEGER;

const totals = (input: Partial<TotalsInput>) =>
  calculateTotals({
    subtotal: 0,
    serviceChargeBps: 0,
    taxBps: 0,
    taxOnService: false,
    ...input,
  });

const invalidNumbers: [string, unknown][] = [
  ["a fraction", 1.5],
  ["a tiny fraction", Number.MIN_VALUE],
  ["negative", -1],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["unsafe", MAX + 1],
  ["a string", "100"],
  ["a bigint", BigInt(100)],
  ["null", null],
  ["undefined", undefined],
];

describe("roundHalfUp", () => {
  it.each([
    [0, 10, 0],
    [4, 10, 0],
    [5, 10, 1],
    [6, 10, 1],
    [10, 10, 1],
    [25, 10, 3], // half to even would give 2
    [35, 10, 4],
    [1, 3, 0],
    [2, 3, 1],
  ])("rounds %i/%i to %i", (numerator, denominator, expected) => {
    expect(roundHalfUp(BigInt(numerator), BigInt(denominator))).toBe(BigInt(expected));
  });
});

describe("rounding of each charge", () => {
  // At 1 bps a subtotal is its own remainder out of 10000.
  const cases = [
    ["just below half", 4999, 0],
    ["exactly half", 5000, 1],
    ["just above half", 5001, 1],
    ["just below one and a half", 14999, 1],
    ["exactly one and a half", 15000, 2],
    ["exactly two and a half", 25000, 3],
  ] as const;

  it.each(cases)("service charge, %s", (_, subtotal, expected) => {
    expect(totals({ subtotal, serviceChargeBps: 1 }).serviceCharge).toBe(expected);
  });

  it.each(cases)("tax, %s", (_, subtotal, expected) => {
    expect(totals({ subtotal, taxBps: 1 }).tax).toBe(expected);
  });

  it.each([
    ["just below half", 3999, 1000, 0],
    ["exactly half", 4000, 1000, 1],
    ["just above half", 4001, 1000, 1],
    ["exactly two and a half", 20000, 5000, 3],
  ])("tax on service, %s", (_, subtotal, serviceCharge, tax) => {
    expect(totals({ subtotal, serviceChargeBps: 2500, taxBps: 1, taxOnService: true })).toEqual({
      subtotal,
      serviceCharge,
      tax,
      total: subtotal + serviceCharge + tax,
    });
  });

  it("rounds service charge and tax separately", () => {
    // 4.5 and 4.5: together they would be 9.
    expect(totals({ subtotal: 45, serviceChargeBps: 1000, taxBps: 1000 })).toEqual({
      subtotal: 45,
      serviceCharge: 5,
      tax: 5,
      total: 55,
    });
  });

  it("taxes the rounded service charge", () => {
    // The base is 90 + 5. On the unrounded 94.5 the tax would be 9.
    expect(
      totals({ subtotal: 90, serviceChargeBps: 500, taxBps: 1000, taxOnService: true }),
    ).toEqual({ subtotal: 90, serviceCharge: 5, tax: 10, total: 105 });
  });
});

describe("calculateTotals", () => {
  const bill = { subtotal: 25_000, serviceChargeBps: 500, taxBps: 1000 };

  it("taxes only the subtotal with the flag off", () => {
    expect(totals({ ...bill, taxOnService: false })).toEqual({
      subtotal: 25_000,
      serviceCharge: 1250,
      tax: 2500,
      total: 28_750,
    });
  });

  it("taxes the service charge too with the flag on", () => {
    expect(totals({ ...bill, taxOnService: true })).toEqual({
      subtotal: 25_000,
      serviceCharge: 1250,
      tax: 2625,
      total: 28_875,
    });
  });

  it.each([false, true])("handles a zero subtotal, flag %s", (taxOnService) => {
    expect(totals({ ...bill, subtotal: 0, taxOnService })).toEqual({
      subtotal: 0,
      serviceCharge: 0,
      tax: 0,
      total: 0,
    });
  });

  it.each([false, true])("handles both rates at zero, flag %s", (taxOnService) => {
    expect(totals({ subtotal: 25_000, taxOnService })).toEqual({
      subtotal: 25_000,
      serviceCharge: 0,
      tax: 0,
      total: 25_000,
    });
  });

  it.each([false, true])("handles a zero service rate, flag %s", (taxOnService) => {
    expect(totals({ ...bill, serviceChargeBps: 0, taxOnService })).toEqual({
      subtotal: 25_000,
      serviceCharge: 0,
      tax: 2500,
      total: 27_500,
    });
  });

  it.each([false, true])("handles a zero tax rate, flag %s", (taxOnService) => {
    expect(totals({ ...bill, taxBps: 0, taxOnService })).toEqual({
      subtotal: 25_000,
      serviceCharge: 1250,
      tax: 0,
      total: 26_250,
    });
  });
});

describe("large amounts", () => {
  it.each([
    [false, 100_000_000_001, 1_150_000_000_006],
    [true, 105_000_000_001, 1_155_000_000_006],
  ])("is exact for a trillion rupiah, flag %s", (taxOnService, tax, total) => {
    const subtotal = 1_000_000_000_005;
    expect(totals({ subtotal, serviceChargeBps: 500, taxBps: 1000, taxOnService })).toEqual({
      subtotal,
      serviceCharge: 50_000_000_000,
      tax,
      total,
    });
  });

  it("is exact close to the safe limit", () => {
    const subtotal = 8_000_000_000_000_005;
    expect(totals({ subtotal, serviceChargeBps: 500, taxBps: 700, taxOnService: true })).toEqual({
      subtotal,
      serviceCharge: 400_000_000_000_000,
      tax: 588_000_000_000_000,
      total: 8_988_000_000_000_005,
    });
  });

  it("rounds down just below half where float math rounds up", () => {
    // The exact tax ends in .4999. Math.round(subtotal * 1001 / 10000) gives ...074.
    const subtotal = 8_007_199_254_735_999;
    expect(totals({ subtotal, taxBps: 1001 }).tax).toBe(801_520_645_399_073);
  });

  it("accepts a total at the safe limit", () => {
    expect(totals({ subtotal: MAX }).total).toBe(MAX);
    expect(totals({ subtotal: 9_006_298_624_878_503, taxBps: 1 }).total).toBe(MAX);
  });

  it.each([
    ["service charge", { subtotal: MAX, serviceChargeBps: 1 }],
    ["tax", { subtotal: MAX, taxBps: 1 }],
    ["huge rate", { subtotal: MAX, taxBps: MAX }],
    ["one rupiah over", { subtotal: 9_006_298_624_878_504, taxBps: 1 }],
  ])("rejects a total past the safe limit: %s", (_, input) => {
    expect(() => totals(input)).toThrow(RangeError);
  });
});

describe("invalid input", () => {
  describe.each(["subtotal", "serviceChargeBps", "taxBps"] as const)("%s", (field) => {
    it.each(invalidNumbers)("rejects %s", (_, value) => {
      expect(() => totals({ [field]: value })).toThrow(
        new RangeError(`${field} must be a non-negative safe integer`),
      );
    });
  });

  it.each(["false", 0, 1, null, undefined])("rejects %j as the flag", (value) => {
    expect(() => totals({ taxOnService: value as unknown as boolean })).toThrow(TypeError);
  });
});

describe("formatMoney", () => {
  it.each([
    [0, "Rp 0"],
    [-0, "Rp 0"],
    [5, "Rp 5"],
    [999, "Rp 999"],
    [1000, "Rp 1.000"],
    [25_000, "Rp 25.000"],
    [100_000, "Rp 100.000"],
    [1_234_567, "Rp 1.234.567"],
    [1_000_000_000_000, "Rp 1.000.000.000.000"],
    [MAX, "Rp 9.007.199.254.740.991"],
  ])("formats %d as %s", (amount, expected) => {
    expect(formatMoney(amount)).toBe(expected);
  });

  it.each(invalidNumbers)("rejects %s", (_, value) => {
    expect(() => formatMoney(value as number)).toThrow(
      new RangeError("amount must be a non-negative safe integer"),
    );
  });
});
