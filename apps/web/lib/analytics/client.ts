import type { PostHog } from "posthog-js/dist/module.slim.no-external";

import { getAnalyticsConfig } from "./config";
import type { EventArgs, EventName } from "./events";
import { describeError, errorDigest, isControlFlow } from "./exception";
import { cleanProperties, isUuid } from "./payload";
import { cleanReferrer, cleanUrl } from "./url";

/**
 * Browser analytics. Call `initAnalytics()` once, from client code. Nothing here throws or waits.
 * Without a key and host, every function does nothing.
 */

const ID_KEY = "restomate.analytics_id";
const USER_KEY = "restomate.analytics_user";
const MAX_ERRORS_PER_LOAD = 10;

let ready: Promise<PostHog | null> | undefined;
let userId: string | null = null;
let organizationId: string | null = null;
let lastPage: string | undefined;
// Memory only, never sent: two orders share one masked URL but are two pageviews.
let lastRawPage: string | undefined;
let errorsSent = 0;
const reported = new WeakSet<object>();

// Our own random ID, so the SDK can keep its state in memory. Its persistence would store the
// first raw URL, and so a reset or invitation token, in localStorage.
function readAnonymousId(): string {
  try {
    const stored = localStorage.getItem(ID_KEY);
    if (isUuid(stored)) return stored;
  } catch {
    // Storage is blocked: a new ID on each load.
  }
  const id = crypto.randomUUID();
  saveAnonymousId(id);
  return id;
}

function saveAnonymousId(id: string) {
  try {
    localStorage.setItem(ID_KEY, id);
  } catch {
    // Storage is blocked.
  }
}

// Kept, so identify is sent once per sign-in and a sign-out after a reload still resets the ID.
function readUserId(): string | null {
  try {
    const stored = localStorage.getItem(USER_KEY);
    return isUuid(stored) ? stored : null;
  } catch {
    return null;
  }
}

function saveUserId(id: string | null) {
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Storage is blocked.
  }
}

function enqueue(task: (posthog: PostHog) => void) {
  void ready
    ?.then((posthog) => {
      if (posthog) task(posthog);
    })
    .catch(() => undefined);
}

async function start(
  key: string,
  host: string,
  identity: { distinctID: string; isIdentifiedID?: boolean },
): Promise<PostHog | null> {
  // The slim build without external loading: no autocapture, recording, surveys or remote code.
  const { default: posthog } = await import("posthog-js/dist/module.slim.no-external");
  const instance = posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    // Also stops the remote config request, so the dashboard can't switch any of this back on.
    advanced_disable_flags: true,
    persistence: "memory",
    save_referrer: false,
    save_campaign_params: false,
    disable_scroll_properties: true,
    disable_compression: true,
    person_profiles: "identified_only",
    // Set, because the SDK otherwise lets a query parameter turn on logging of payloads.
    debug: false,
    bootstrap: identity,
    before_send: (data) => {
      if (!data) return null;
      const distinctId = data.properties.distinct_id;
      if (!isUuid(distinctId)) return null;
      const properties = cleanProperties(data.event, data.properties);
      if (!properties) return null;
      return {
        uuid: data.uuid,
        event: data.event,
        timestamp: data.timestamp,
        properties: { ...properties, token: key, distinct_id: distinctId },
      };
    },
  });
  return instance ?? null;
}

/** Page and organization as they are when the call is made, not when the SDK has loaded. */
function pageContext() {
  return {
    $current_url: cleanUrl(location.href),
    ...(organizationId && { $groups: { organization: organizationId } }),
  };
}

/** Starts analytics, sends the first pageview and reports uncaught errors. Safe to call again. */
export function initAnalytics(): void {
  try {
    if (typeof window === "undefined" || ready) return;
    const config = getAnalyticsConfig();
    if (!config) return;

    userId = readUserId();
    const identity = userId
      ? { distinctID: userId, isIdentifiedID: true }
      : { distinctID: readAnonymousId() };
    ready = start(config.key, config.host, identity).catch(() => null);
    window.addEventListener("error", (event) => report(event.error, false));
    window.addEventListener("unhandledrejection", (event) => report(event.reason, false));
    capturePageview();
  } catch {
    // Analytics never breaks the app.
  }
}

/** Call with the new URL on navigation, e.g. from `onRouterTransitionStart`. */
export function capturePageview(url?: string): void {
  try {
    if (!ready) return;
    const raw = new URL(url ?? location.href, location.href).href;
    if (raw === lastRawPage) return;
    lastRawPage = raw;
    const current = cleanUrl(raw);
    const referrer = lastPage ?? cleanReferrer(document.referrer);
    lastPage = current;
    const properties = { ...pageContext(), $current_url: current, $referrer: referrer };
    enqueue((posthog) => posthog.capture("$pageview", properties));
  } catch {
    // Analytics never breaks the app.
  }
}

export function capture<E extends EventName>(event: E, ...args: EventArgs<E>): void {
  try {
    if (!ready) return;
    const properties = { ...args[0], ...pageContext() };
    enqueue((posthog) => posthog.capture(event, properties));
  } catch {
    // Analytics never breaks the app.
  }
}

/** The Supabase user ID after sign-in, `null` after sign-out. Never an email. */
export function setAnalyticsUser(id: string | null): void {
  try {
    if (!ready) return;
    const next = isUuid(id) ? id : null;
    if (next === userId) return;
    const signedOut = userId !== null;
    userId = next;
    saveUserId(next);
    if (signedOut) organizationId = null;

    enqueue((posthog) => {
      if (signedOut) {
        // A new anonymous ID, so the next person on this device isn't linked to the last one.
        posthog.reset();
        saveAnonymousId(posthog.get_distinct_id());
      }
      if (next) posthog.identify(next);
    });
  } catch {
    // Analytics never breaks the app.
  }
}

/** The active organization's ID, or `null`. Never its name or slug. */
export function setAnalyticsOrganization(id: string | null): void {
  organizationId = isUuid(id) ? id : null;
}

function report(error: unknown, handled: boolean) {
  try {
    if (!ready || error == null || errorsSent >= MAX_ERRORS_PER_LOAD || isControlFlow(error))
      return;
    if (typeof error === "object") {
      if (reported.has(error)) return;
      reported.add(error);
    }
    errorsSent++;
    const properties = {
      ...pageContext(),
      $exception_list: [describeError(error, handled)],
      $exception_source: "client",
      $exception_digest: errorDigest(error),
    };
    enqueue((posthog) => posthog.capture("$exception", properties));
  } catch {
    // Analytics never breaks the app.
  }
}

/** For error boundaries and caught errors. The message is never sent. */
export function captureError(error: unknown): void {
  report(error, true);
}
