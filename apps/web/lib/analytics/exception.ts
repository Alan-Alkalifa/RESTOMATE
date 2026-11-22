/**
 * An error as it may leave the app: its type, a known kind of code and frames from our own
 * bundles. Never the message (a name in free text can't be detected), a function name (it can be
 * computed from data) or source lines.
 */

const TYPES = new Set([
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AbortError",
  "ChunkLoadError",
  "NetworkError",
  "NotAllowedError",
  "QuotaExceededError",
  "SecurityError",
  "TimeoutError",
  "EnvError",
  "ZodError",
  "AuthApiError",
  "AuthRetryableFetchError",
  "AuthSessionMissingError",
  "PostgrestError",
  "StorageError",
]);

// Postgres SQLSTATE classes we can hit, PostgREST codes and Node network codes.
const CODE =
  /^(?:(?:08|22|23|25|28|40|42|53|54|55|57)[0-9A-Z]{3}|P000[0-4]|PGRST\d{3}|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)$/;

const BUNDLE_FILE =
  /(?:^|\/)((?:\.next\/(?:dev\/)?server|_next\/static)\/(?:[\w.~[\]-]+\/)*[\w.~[\]-]+\.js)(?:\?.*)?$/;

const MAX_FRAMES = 30;
const REMOVED = "Message removed";

type Frame = {
  platform: "custom";
  lang: "javascript";
  function: "?";
  filename: string;
  lineno: number;
  colno: number;
  in_app: true;
  resolved: true;
};

export type CleanException = {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: false };
  stacktrace?: { type: "raw"; frames: Frame[] };
};

function read(source: unknown, key: string): unknown {
  try {
    return typeof source === "object" && source !== null
      ? (source as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined; // a throwing getter
  }
}

function cleanFile(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 500) return undefined;
  const file = BUNDLE_FILE.exec(value.replaceAll("\\", "/"))?.[1];
  // A long unbroken run is a token, not a chunk name.
  if (!file || file.includes("..") || /[A-Za-z0-9]{32}/.test(file)) return undefined;
  return file;
}

function cleanFrame(file: unknown, line: unknown, column: unknown): Frame | undefined {
  const filename = cleanFile(file);
  if (!filename) return undefined;
  if (!Number.isInteger(line) || !Number.isInteger(column)) return undefined;
  const lineno = line as number;
  const colno = column as number;
  // The upper limits keep a phone number from passing as a position.
  if (lineno < 1 || lineno >= 1_000_000 || colno < 0 || colno >= 10_000_000) return undefined;

  return {
    platform: "custom",
    lang: "javascript",
    function: "?",
    filename,
    lineno,
    colno,
    in_app: true,
    resolved: true,
  };
}

/**
 * The frame lines only. A message can contain lines that look like frames, so when the message
 * can't be cut off the front with certainty there are no frames at all.
 */
function frameLines(stack: string, message: string): string[] {
  if (!/^\s+at /m.test(stack)) {
    // Firefox and Safari stacks have no message, only `function@file:line:column`.
    return message && stack.includes(message) ? [] : stack.split("\n");
  }

  const firstLine = stack.split("\n", 1)[0];
  let rest: string;
  if (message) {
    const start = stack.indexOf(message);
    if (start < 0 || start > firstLine.length) return [];
    if (!/^[\w$.[\] ]+: $/.test(stack.slice(0, start))) return [];
    rest = stack.slice(start + message.length);
  } else {
    if (!/^[\w$.[\] ]+$/.test(firstLine)) return [];
    rest = stack.slice(firstLine.length);
  }
  if (!rest.startsWith("\n")) return [];

  const lines = rest.slice(1).split("\n");
  const end = lines.findIndex((line) => !/^\s+at /.test(line));
  return end < 0 ? lines : lines.slice(0, end);
}

function parseFrames(error: unknown): Frame[] {
  const stack = read(error, "stack");
  const message = read(error, "message");
  if (typeof stack !== "string" || typeof message !== "string") return [];

  const frames: Frame[] = [];
  for (const line of frameLines(stack, message).slice(0, MAX_FRAMES)) {
    const position = /:(\d+):(\d+)\)?$/.exec(line);
    if (!position) continue;
    const file = line.slice(0, position.index).replace(/^.*[(@]|^\s+at /, "");
    const frame = cleanFrame(file, Number(position[1]), Number(position[2]));
    if (frame) frames.push(frame);
  }
  return frames.reverse(); // PostHog wants the oldest call first
}

function assemble(type: unknown, code: unknown, handled: unknown, frames: Frame[]): CleanException {
  return {
    type: typeof type === "string" && TYPES.has(type) ? type : "Error",
    value: typeof code === "string" && CODE.test(code) ? code : REMOVED,
    mechanism: { handled: handled === true, synthetic: false },
    ...(frames.length > 0 && { stacktrace: { type: "raw" as const, frames } }),
  };
}

export function describeError(error: unknown, handled: boolean): CleanException {
  return assemble(read(error, "name"), read(error, "code"), handled, parseFrames(error));
}

/** The same rules again, for a payload that is about to be sent. */
export function cleanExceptionList(list: unknown): CleanException[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list.slice(0, 1).map((item: unknown) => {
    const raw = read(read(item, "stacktrace"), "frames");
    const frames = (Array.isArray(raw) ? raw.slice(0, MAX_FRAMES) : [])
      .map((f: unknown) => cleanFrame(read(f, "filename"), read(f, "lineno"), read(f, "colno")))
      .filter((f) => f !== undefined);
    const handled = read(read(item, "mechanism"), "handled");
    return assemble(read(item, "type"), read(item, "value"), handled, frames);
  });
}

/** Next's hash that links the error page to the server log. */
export function cleanDigest(value: unknown): string | undefined {
  return typeof value === "string" && /^[1-9]\d{0,9}(?:@E\d{1,5})?$/.test(value)
    ? value
    : undefined;
}

export function errorDigest(error: unknown): string | undefined {
  return cleanDigest(read(error, "digest"));
}

/** redirect(), notFound() and the like are thrown, but aren't errors. */
export function isControlFlow(error: unknown): boolean {
  const digest = read(error, "digest");
  return typeof digest === "string" && /^NEXT_|^DYNAMIC_SERVER_USAGE$/.test(digest);
}
