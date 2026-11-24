"use client";

import { PageError } from "@/components/shell/notices";

/** The lookup failed (not "no such restaurant"). Retry; the error itself is never shown. */
export default function StorefrontError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-page">
      <PageError reset={reset} />
    </main>
  );
}
