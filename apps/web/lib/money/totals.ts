import { assertWholeNumber } from "./assert";
import { roundHalfUp } from "./rounding";

const BPS_PER_WHOLE = BigInt(10_000);

export type TotalsInput = {
  /** In the smallest currency unit (IDR: whole rupiah). */
  subtotal: number;
  /** In basis points: 500 is 5%. */
  serviceChargeBps: number;
  /** In basis points: 1000 is 10%. */
  taxBps: number;
  /** The location's tax-on-service flag. */
  taxOnService: boolean;
};

export type Totals = {
  subtotal: number;
  serviceCharge: number;
  tax: number;
  total: number;
};

/**
 * Service charge and tax are each rounded once. With tax on service, tax is charged on the
 * rounded service charge, which is the amount the bill shows.
 *
 * Throws a RangeError if an amount or rate is invalid or the total is not a safe integer, and a
 * TypeError if the flag is not a boolean.
 */
export function calculateTotals(input: TotalsInput): Totals {
  const { subtotal, serviceChargeBps, taxBps, taxOnService } = input;

  assertWholeNumber(subtotal, "subtotal");
  assertWholeNumber(serviceChargeBps, "serviceChargeBps");
  assertWholeNumber(taxBps, "taxBps");
  // A string "false" is truthy and would add tax without an error.
  if (typeof taxOnService !== "boolean") throw new TypeError("taxOnService must be a boolean");

  // BigInt, because amount * rate can pass Number.MAX_SAFE_INTEGER.
  const base = BigInt(subtotal);
  const serviceCharge = roundHalfUp(base * BigInt(serviceChargeBps), BPS_PER_WHOLE);
  const taxBase = taxOnService ? base + serviceCharge : base;
  const tax = roundHalfUp(taxBase * BigInt(taxBps), BPS_PER_WHOLE);
  const total = base + serviceCharge + tax;

  // No part is larger than the total, so this check covers all of them.
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("total must be a non-negative safe integer");
  }

  return {
    subtotal,
    serviceCharge: Number(serviceCharge),
    tax: Number(tax),
    total: Number(total),
  };
}
