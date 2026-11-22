// BigInt() instead of 1n literals: the tsconfig target is ES2017.
const TWO = BigInt(2);

/**
 * The only rounding rule for money: half up to the smallest unit.
 * A default until the M3 Plan confirms it (docs/PLAN.md §14).
 * Expects numerator >= 0 and denominator > 0.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * TWO + denominator) / (denominator * TWO);
}
