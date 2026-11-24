"use client";

import { PageError } from "@/components/shell/notices";

/** The error screen for everything under `/app`. The error itself is never shown. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return <PageError reset={reset} />;
}
