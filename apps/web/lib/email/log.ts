import { z } from "zod";

import { EMAIL_KINDS } from "./message";

type Entry = {
  kind: unknown;
  referenceId: unknown;
  outcome: "logged" | "sent" | "failed";
  /** Our own code, never provider or exception text. */
  error?: string;
  httpStatus?: number;
};

const kinds = z.enum(EMAIL_KINDS);
const uuid = z.guid();

/**
 * One line per attempt. It has no place for the recipient, subject, body, links, key or any
 * provider text. Kind and ID are checked again, because invalid input is logged too.
 */
export function logAttempt({ kind, referenceId, outcome, error, httpStatus }: Entry): void {
  const line = JSON.stringify({
    event: "email",
    kind: kinds.safeParse(kind).data ?? "unknown",
    referenceId:
      typeof referenceId === "string" && referenceId.length === 36
        ? uuid.safeParse(referenceId).data
        : undefined,
    outcome,
    error,
    httpStatus,
  });
  if (outcome === "failed") console.error(line);
  else console.info(line);
}
