import { EVENTS } from "./events";
import { cleanDigest, cleanExceptionList } from "./exception";
import { cleanReferrer, cleanRoute, cleanUrl } from "./url";

type Properties = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_SOURCES = ["client", "render", "route", "action", "proxy"];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * The last step before either SDK sends. It builds a new object from an allow-list and never
 * copies, so whatever the SDK or a caller added (raw URLs, persisted properties, `$set`) is
 * dropped. Returns null for an event that must not be sent.
 */
export function cleanProperties(event: string, input: Properties): Properties | null {
  const output: Properties = {
    $geoip_disable: true,
    // Set, so ingestion doesn't fill it in with the sender's address.
    $ip: null,
  };

  if (own(EVENTS, event)) {
    const spec: Record<string, readonly string[]> = EVENTS[event as keyof typeof EVENTS];
    for (const [key, allowed] of Object.entries(spec)) {
      const value = input[key];
      if (typeof value === "string" && allowed.includes(value)) output[key] = value;
    }
  } else if (event === "$identify") {
    if (isUuid(input.$anon_distinct_id)) output.$anon_distinct_id = input.$anon_distinct_id;
  } else if (event === "$exception") {
    const list = cleanExceptionList(input.$exception_list);
    if (!list) return null;
    output.$exception_list = list;

    const source = input.$exception_source;
    if (typeof source === "string" && ERROR_SOURCES.includes(source)) {
      output.$exception_source = source;
    }
    if (input.$exception_route !== undefined) {
      output.$exception_route = cleanRoute(input.$exception_route);
    }
    const digest = cleanDigest(input.$exception_digest);
    if (digest) output.$exception_digest = digest;
  } else if (event !== "$pageview") {
    return null;
  }

  if (input.$current_url !== undefined) {
    const current = cleanUrl(input.$current_url);
    const url = new URL(current);
    output.$current_url = current;
    output.$host = url.host;
    output.$pathname = url.pathname;
  }
  if (input.$referrer !== undefined) {
    const referrer = cleanReferrer(input.$referrer);
    output.$referrer = referrer;
    output.$referring_domain = referrer === "$direct" ? referrer : new URL(referrer).host;
  }

  const organization = (input.$groups as { organization?: unknown } | null | undefined)
    ?.organization;
  if (isUuid(organization)) output.$groups = { organization };

  if (isUuid(input.$session_id)) output.$session_id = input.$session_id;
  if (typeof input.$process_person_profile === "boolean") {
    output.$process_person_profile = input.$process_person_profile;
  }
  if (input.$is_server === true) output.$is_server = true;
  if (input.$lib === "web" || input.$lib === "posthog-node") output.$lib = input.$lib;
  if (
    typeof input.$lib_version === "string" &&
    /^\d{1,3}\.\d{1,4}\.\d{1,3}$/.test(input.$lib_version)
  ) {
    output.$lib_version = input.$lib_version;
  }
  return output;
}
