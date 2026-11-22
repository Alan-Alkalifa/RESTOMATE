import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { PostHog } from "posthog-node";

import { getAnalyticsConfig } from "./config";
import type { EventArgs, EventName } from "./events";
import { describeError, errorDigest, isControlFlow } from "./exception";
import { cleanProperties, isUuid } from "./payload";

/** Server analytics (Node only). Nothing here throws, and no caller waits for the network. */

const TIMEOUT_MS = 2000;
const MAX_IN_FLIGHT = 50;
// Where Next itself finds the platform's waitUntil (see the `after` docs).
const REQUEST_CONTEXT = Symbol.for("@next/request-context");

let client: PostHog | undefined;
let inFlight = 0;

function getClient(): PostHog | undefined {
  if (client) return client;
  // A build renders pages: nothing is sent from it.
  if (process.env.NEXT_PHASE === "phase-production-build") return undefined;
  const config = getAnalyticsConfig();
  if (!config) return undefined;

  client = new PostHog(config.key, {
    host: config.host,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: TIMEOUT_MS,
    fetchRetryCount: 0,
    enableExceptionAutocapture: false,
    beforeSend: (message) => {
      if (!message || !isUuid(message.distinctId)) return null;
      const properties = cleanProperties(message.event, message.properties ?? {});
      if (!properties) return null;
      return {
        distinctId: message.distinctId,
        event: message.event,
        uuid: message.uuid,
        timestamp: message.timestamp,
        properties,
      };
    },
  });
  // A failed send is dropped. Without a listener the SDK logs each one.
  client.on("error", () => undefined);
  return client;
}

/** Lets the response finish first and keeps a serverless function alive until the send is done. */
function inBackground(task: Promise<void>) {
  try {
    after(task);
    return;
  } catch {
    // Not in a request scope, as in some error hooks.
  }
  try {
    const context = (
      globalThis as {
        [REQUEST_CONTEXT]?: { get(): { waitUntil?(task: Promise<void>): void } | undefined };
      }
    )[REQUEST_CONTEXT];
    context?.get()?.waitUntil?.(task);
  } catch {
    // A long-running server finishes the send by itself.
  }
}

function send(event: string, distinctId: string, properties: Record<string, unknown>) {
  const posthog = getClient();
  if (!posthog || inFlight >= MAX_IN_FLIGHT) return;
  inFlight++;
  const task = posthog
    .captureImmediate({ event, distinctId, properties })
    .catch(() => undefined)
    .finally(() => {
      inFlight--;
    });
  inBackground(task);
}

type Who = {
  /** The Supabase user ID. Left out, the event belongs to no person. */
  userId?: string;
  organizationId?: string;
};

export function captureServerEvent<E extends EventName>(
  who: Who,
  event: E,
  ...args: EventArgs<E>
): void {
  try {
    const user = isUuid(who.userId) ? who.userId : undefined;
    send(event, user ?? randomUUID(), {
      ...args[0],
      $process_person_profile: user !== undefined,
      ...(who.organizationId && { $groups: { organization: who.organizationId } }),
    });
  } catch {
    // Analytics never breaks the app.
  }
}

export type ServerErrorContext = {
  source: "render" | "route" | "action" | "proxy";
  /** The route template, never the requested path. */
  route?: string;
  handled?: boolean;
};

/** The message is never sent. See `exception.ts` for what is. */
export function captureServerError(error: unknown, context: ServerErrorContext): void {
  try {
    if (isControlFlow(error)) return;
    send("$exception", randomUUID(), {
      $process_person_profile: false,
      $exception_list: [describeError(error, context.handled ?? false)],
      $exception_source: context.source,
      $exception_route: context.route,
      $exception_digest: errorDigest(error),
    });
  } catch {
    // Analytics never breaks the app.
  }
}
