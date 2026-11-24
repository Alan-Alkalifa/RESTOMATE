import { mailpitUrl } from "./wait-for-stack";

// Mailpit API v1: every local Auth and app email lands here (http://127.0.0.1:54324).

export type MailpitMessage = {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
  Created: string;
};

export async function clearInbox(): Promise<void> {
  const res = await fetch(`${mailpitUrl()}/api/v1/messages`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Mailpit clear failed: ${res.status}`);
}

export async function listMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpitUrl()}/api/v1/messages`);
  if (!res.ok) throw new Error(`Mailpit list failed: ${res.status}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

/** Waits for the newest message sent to `to`, then returns its HTML, text and subject. */
export async function waitForMail(to: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await listMessages()).find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()),
    );
    if (hit) {
      const res = await fetch(`${mailpitUrl()}/api/v1/message/${hit.ID}`);
      const full = (await res.json()) as { Subject: string; HTML: string; Text: string };
      return { id: hit.ID, subject: full.Subject, html: full.HTML, text: full.Text };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No mail for ${to} within ${timeoutMs / 1000}s`);
}

/** First link in a mail body that contains `needle` (for example "/auth/confirm"). */
export function findLink(body: string, needle: string): string {
  const match = [...body.matchAll(/https?:\/\/[^\s"'<>)]+/g)]
    .map((m) => m[0].replace(/&amp;/g, "&"))
    .find((l) => l.includes(needle));
  if (!match) throw new Error(`No link containing ${needle} in the mail`);
  return match;
}

/** Waits for a mail to `to` whose HTML or text contains `needle`, newest first. */
export async function waitForMailWith(to: string, needle: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hits = (await listMessages()).filter((m) =>
      m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()),
    );
    for (const hit of hits) {
      const full = (await (await fetch(`${mailpitUrl()}/api/v1/message/${hit.ID}`)).json()) as {
        Subject: string;
        HTML: string;
        Text: string;
      };
      if ((full.HTML + full.Text).includes(needle))
        return { id: hit.ID, subject: full.Subject, html: full.HTML, text: full.Text };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No mail for ${to} containing ${needle} within ${timeoutMs / 1000}s`);
}
