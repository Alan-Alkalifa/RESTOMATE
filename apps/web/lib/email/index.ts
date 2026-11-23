import { resendTransport } from "./resend";
import { createSender } from "./sender";

/**
 * Sends one email through Resend, or logs it in `log` mode. Never throws. Retry a failure with
 * `retryable: true` by calling again with the same message and the same `idempotencyKey`.
 */
export const sendEmail = createSender(resendTransport);

export { EMAIL_KINDS, type EmailKind, type EmailMessage } from "./message";
export type { SendError, SendResult } from "./sender";
