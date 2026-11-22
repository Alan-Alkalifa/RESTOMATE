import { gunzipSync } from "node:zlib";
import { expect, vi } from "vitest";

/** Dummy values, seeded into every input. None may appear in anything sent. */
export const SEEDS = {
  tokenHash: "pkce_5f1d0c9e8b7a69584736251403f2e1d0c9b8a7968574635241302f1e",
  inviteToken: "Zm9vYmFyLWludml0ZS10b2tlbi1zZWVk",
  resetToken: "reset-91c7d2e4b6a8",
  qrToken: "qr7h3k9m2p",
  accessToken: "eyJhbGciOiJIUzI1NiJ9.c2VlZA.c2lnbmF0dXJl",
  password: "hunter2seed",
  email: "siti.rahayu@example.com",
  emailUser: "siti.rahayu",
  phone: "6281234567890",
  localPhone: "081234567890",
  firstName: "Rahayu",
  lastName: "Kusumawati",
  slug: "warung-bu-kusuma",
} as const;

export const KEY = "phc_dummy_test_key";
export const HOST = "https://posthog.stub.test";
export const APP = "https://app.restomate.test";
export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const ORG = "33333333-3333-4333-8333-333333333333";

export function stubEnv() {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", HOST);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "restomate.test");
  vi.stubEnv("NEXT_PHASE", "");
}

/** An error with a seed in every place an error can hold one. */
export function seededError() {
  const s = SEEDS;
  const message = [
    `Invite for ${s.firstName} ${s.lastName} <${s.email}> +${s.phone} ${s.localPhone} failed`,
    `at ${APP}/invite/${s.inviteToken}?token_hash=${s.tokenHash}&access_token=${s.accessToken}`,
    `    at ${s.firstName} (/var/task/.next/server/${s.resetToken}.js:1:2)`,
    `password ${s.password}, table ${s.qrToken}, tenant ${s.slug}`,
  ].join("\n");
  const error = new TypeError(message, { cause: new Error(s.email) });
  error.stack = [
    `TypeError: ${message}`,
    `    at ${s.lastName} (/var/task/apps/web/.next/server/chunks/ssr/0abc_page_1x2y.js:12:345)`,
    `    at ${APP}/invite/${s.inviteToken}:3:4`,
    `    at ${APP}/reset-password/${s.resetToken}.js:5:6`,
    `    at /home/${s.emailUser}/app.js:7:8`,
    "    at https://app.restomate.test/_next/static/chunks/0def-abc.js?dpl=dpl_1:9:10",
  ].join("\n");
  return Object.assign(error, {
    digest: s.phone,
    code: s.resetToken,
    email: s.email,
    phone: s.phone,
    full_name: `${s.firstName} ${s.lastName}`,
  });
}

export type Sent = { url: string; headers: string; body: string };
export type SentEvent = {
  event: string;
  distinct_id?: string;
  timestamp?: string;
  properties: Record<string, unknown>;
  options?: Record<string, unknown>;
};

export async function readRequest(
  url: string,
  init: { headers?: unknown; body?: unknown } = {},
): Promise<Sent> {
  const headers = JSON.stringify(
    init.headers instanceof Headers ? Object.fromEntries(init.headers) : (init.headers ?? {}),
  );

  let bytes = Buffer.alloc(0);
  const body = init.body;
  if (typeof body === "string") bytes = Buffer.from(body);
  else if (body instanceof Uint8Array) bytes = Buffer.from(body);
  else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
  else if (body instanceof Blob) {
    // jsdom's Blob has no arrayBuffer(), so go through a FileReader when there is one.
    bytes = Buffer.from(
      typeof body.arrayBuffer === "function"
        ? await body.arrayBuffer()
        : await new Promise<ArrayBuffer>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.readAsArrayBuffer(body);
          }),
    );
  } else if (body != null) throw new Error("Unknown body type, so it can't be checked");

  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  let text = bytes.toString("utf8");
  // Unload sends base64, as a form field or as the whole body. Decode it, or the search is blind.
  if (text.startsWith("data=")) text = new URLSearchParams(text).get("data") ?? "";
  if (text && !/^[[{]/.test(text)) text = Buffer.from(text, "base64").toString("utf8");
  if (text) JSON.parse(text); // a body that can't be read can't pass
  return { url, headers, body: text };
}

/** Looks for each seed as it is, URL-encoded and base64-encoded, in URL, headers and body. */
export function expectNoSeeds(sent: Sent[]) {
  expect(sent.length).toBeGreaterThan(0);
  const wire = JSON.stringify(sent).toLowerCase();
  for (const [name, value] of Object.entries(SEEDS)) {
    for (const form of [value, encodeURIComponent(value), Buffer.from(value).toString("base64")]) {
      expect(wire.includes(form.toLowerCase()), `${name} left the app`).toBe(false);
    }
  }
}

export function eventsIn(sent: Sent[]): SentEvent[] {
  return sent.flatMap((request) => {
    const parsed = JSON.parse(request.body);
    return Array.isArray(parsed) ? parsed : (parsed.batch ?? parsed.data ?? [parsed]);
  });
}
