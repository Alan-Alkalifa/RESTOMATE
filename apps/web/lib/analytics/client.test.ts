// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://app.restomate.test/auth/confirm"}
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  APP,
  eventsIn,
  expectNoSeeds,
  HOST,
  KEY,
  ORG,
  readRequest,
  SEEDS as S,
  seededError,
  stubEnv,
  USER_A,
  USER_B,
  type Sent,
  type SentEvent,
} from "./testing/helpers";

// The real SDK, which keeps one instance per module: one long scenario, many assertions.
const sent: Promise<Sent>[] = [];
let requests: Sent[];
let events: SentEvent[];
let storage: string;
let firstId: string;

const named = (name: string) => events.filter((e) => e.event === name);
const prop = (event: SentEvent, key: string) => event.properties[key];
const distinctId = (event: SentEvent) => event.distinct_id ?? prop(event, "distinct_id");

beforeAll(async () => {
  stubEnv();
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push(readRequest(String(url), init));
    return Promise.resolve(new Response('{"status":1}', { status: 200 }));
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, body: unknown) => {
      sent.push(readRequest(String(url), { body }));
      return true;
    },
  });
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation((_method, url) => {
    sent.push(readRequest(String(url)));
  });
  vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => undefined);

  localStorage.clear();
  history.replaceState(
    null,
    "",
    `/auth/confirm?token_hash=${S.tokenHash}&email=${encodeURIComponent(S.email)}&phone=${S.phone}` +
      `&name=${S.firstName}&utm_campaign=${S.lastName}&utm_source=google&utm_medium=${S.password}` +
      `&lang=id&__posthog_debug=true#access_token=${S.accessToken}`,
  );
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: `${APP}/invite/${S.inviteToken}?email=${S.email}&reset=${S.resetToken}`,
  });
  document.title = `${S.firstName} ${S.lastName}`;

  const analytics = await import("./client");
  analytics.initAnalytics();
  analytics.initAnalytics(); // no second pageview
  firstId = localStorage.getItem("restomate.analytics_id") ?? "";

  analytics.capture("signup_completed", {
    locale: "id",
    email: S.email,
    phone: S.phone,
    full_name: S.firstName,
    $set: { email: S.email, name: S.lastName },
    $set_once: { phone: S.phone },
  } as never);
  analytics.capture("member_invited", { role: S.email } as never);
  analytics.capture("not_an_event" as never, { email: S.email } as never);

  analytics.setAnalyticsUser(USER_A);
  analytics.setAnalyticsUser(USER_A); // identify once
  analytics.setAnalyticsOrganization(ORG);
  analytics.capture("organization_created");

  analytics.capturePageview(`/invite/${S.inviteToken}?email=${S.email}#${S.accessToken}`);
  analytics.capturePageview(`/reset-password/${S.resetToken}/${S.phone}`);
  analytics.capturePageview(`https://${S.slug}.restomate.test/t/${S.qrToken}`);
  analytics.capturePageview(`/customers/${S.firstName}-${S.lastName}/${S.email}/${S.localPhone}`);

  analytics.captureError(seededError());
  analytics.captureError(`${S.email} ${S.password}`);
  analytics.captureError({ message: S.firstName, digest: "NEXT_REDIRECT;replace;/login;307;" });
  window.dispatchEvent(new ErrorEvent("error", { error: seededError(), message: S.email }));
  const rejection = new Event("unhandledrejection");
  Object.assign(rejection, { reason: seededError() });
  window.dispatchEvent(rejection);

  analytics.setAnalyticsUser(null);
  analytics.capture("signup_completed", { locale: "en" });
  analytics.setAnalyticsUser(S.email); // not an ID
  analytics.setAnalyticsOrganization(S.slug);
  analytics.setAnalyticsUser(USER_B);

  // The batch timer is 3 seconds.
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0), { timeout: 8000, interval: 100 });
  await new Promise((resolve) => setTimeout(resolve, 200));

  analytics.capture("member_invited", { role: "cashier" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  window.dispatchEvent(new Event("pagehide")); // the unload path
  await new Promise((resolve) => setTimeout(resolve, 200));

  requests = await Promise.all(sent);
  events = eventsIn(requests);
  storage = JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]);
}, 20_000);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what the browser sends", () => {
  it("holds no seeded token or personal field, in any URL, header or body", () => {
    expectNoSeeds(requests);
  });

  it("goes only to the capture endpoint: no flags, config, recorder or script", () => {
    for (const { url } of requests) {
      expect(new URL(url).origin).toBe(HOST);
      expect(new URL(url).pathname).toMatch(/^\/(e|i\/v0\/e|batch)\/$/);
    }
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });

  it("holds explicit events only", () => {
    expect(new Set(events.map((e) => e.event))).toEqual(
      new Set([
        "$pageview",
        "signup_completed",
        "member_invited",
        "organization_created",
        "$identify",
        "$exception",
      ]),
    );
  });

  it("holds allow-listed properties only", () => {
    const allowed = new Set(
      `token distinct_id $ip $geoip_disable $current_url $host $pathname $referrer $referring_domain
      $groups $session_id $process_person_profile $lib $lib_version $anon_distinct_id
      $exception_list $exception_source $exception_digest locale role`.split(/\s+/),
    );
    const envelope = ["uuid", "event", "timestamp", "properties", "offset"];
    for (const event of events) {
      expect(Object.keys(event).filter((key) => !envelope.includes(key))).toEqual([]);
      expect(Object.keys(event.properties).filter((key) => !allowed.has(key))).toEqual([]);
      expect(event.properties).toMatchObject({ token: KEY, $ip: null, $geoip_disable: true });
    }
  });

  it("masks page URLs and keeps only allow-listed query values", () => {
    expect(named("$pageview").map((e) => prop(e, "$current_url"))).toEqual([
      `${APP}/auth/confirm?lang=id&utm_source=google`,
      `${APP}/invite/:id`,
      `${APP}/reset-password/:id/:id`,
      "https://tenant.restomate.test/t/:id",
      `${APP}/customers/:id/:id/:id`,
    ]);
  });

  it("masks referrers", () => {
    expect(named("$pageview").map((e) => prop(e, "$referrer"))).toEqual([
      `${APP}/invite/:id`,
      `${APP}/auth/confirm?lang=id&utm_source=google`,
      `${APP}/invite/:id`,
      `${APP}/reset-password/:id/:id`,
      "https://tenant.restomate.test/t/:id",
    ]);
  });

  it("keeps valid event values and drops the rest", () => {
    expect(named("signup_completed").map((e) => prop(e, "locale"))).toEqual(["id", "en"]);
    expect(named("member_invited").map((e) => prop(e, "role"))).toEqual([undefined, "cashier"]);
  });

  it("groups by organization ID, until sign-out", () => {
    const groups = { organization: ORG };
    expect(prop(named("organization_created")[0], "$groups")).toEqual(groups);
    const [before, after] = named("signup_completed");
    expect(prop(before, "$groups")).toBeUndefined();
    expect(prop(after, "$groups")).toBeUndefined();
  });

  it("identifies once per sign-in, by ID, and resets on sign-out", () => {
    const [a, b, ...more] = named("$identify");
    expect(more).toEqual([]);
    expect(distinctId(a)).toBe(USER_A);
    expect(prop(a, "$anon_distinct_id")).toBe(firstId);
    expect(distinctId(b)).toBe(USER_B);
    expect(prop(b, "$anon_distinct_id")).not.toBe(firstId);
    expect(prop(b, "$anon_distinct_id")).not.toBe(USER_A);
    expect(distinctId(named("signup_completed")[1])).not.toBe(USER_A);
  });

  it("reports errors by type and bundle position only", () => {
    const errors = named("$exception");
    expect(errors).toHaveLength(4); // not the redirect
    expect(prop(errors[0], "$exception_list")).toEqual([
      {
        type: "TypeError",
        value: "Message removed",
        mechanism: { handled: true, synthetic: false },
        stacktrace: {
          type: "raw",
          frames: [
            ["_next/static/chunks/0def-abc.js", 9, 10],
            [".next/server/chunks/ssr/0abc_page_1x2y.js", 12, 345],
          ].map(([filename, lineno, colno]) => ({
            platform: "custom",
            lang: "javascript",
            function: "?",
            filename,
            lineno,
            colno,
            in_app: true,
            resolved: true,
          })),
        },
      },
    ]);
    for (const error of errors.slice(2)) {
      expect(JSON.stringify(prop(error, "$exception_list"))).toContain('"handled":false');
    }
  });

  it("stores only random and user IDs on the device", () => {
    expectNoSeeds([{ url: "", headers: "", body: storage }]);
    const [local, session, cookie] = JSON.parse(storage);
    expect(Object.keys(local).sort()).toEqual([
      "restomate.analytics_id",
      "restomate.analytics_user",
    ]);
    expect(session).toEqual({});
    expect(cookie).toBe("");
  });
});
