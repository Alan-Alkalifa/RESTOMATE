import { assertWholeNumber } from "./assert";

/**
 * Formats whole rupiah as `Rp 25.000`, in both languages.
 * Not Intl: it puts U+00A0 after `Rp`, and its output can differ between server and browser ICU
 * versions, which breaks hydration.
 */
export function formatMoney(amount: number): string {
  assertWholeNumber(amount, "amount");
  return `Rp ${String(amount).replace(/\B(?=(\d{3})+$)/g, ".")}`;
}
