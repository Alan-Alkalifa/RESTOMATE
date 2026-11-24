/** Join class names, skipping anything falsy. Tailwind classes are written whole, so no merging is needed. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
