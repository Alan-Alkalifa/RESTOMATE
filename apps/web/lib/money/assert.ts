/** Amounts (smallest currency unit) and rates (basis points) are safe integers, zero or more. */
export function assertWholeNumber(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
