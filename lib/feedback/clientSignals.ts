/**
 * What went wrong on the page before someone pressed Feedback, gathered in the
 * browser so the report carries it without anyone having to describe it: the
 * last page errors (uncaught errors, unhandled promise rejections and
 * console.error) and the last same-origin requests that answered 400 or worse.
 *
 * Nothing leaves the browser until Feedback is sent. Installed once, by the
 * Feedback button on mount, so errors from before that are not seen.
 */

const MAX = 20;
const MAX_MESSAGE = 500;

export type ClientError = { at: string; kind: "error" | "rejection" | "console"; message: string };
export type FailedRequest = { at: string; path: string; status: number; durationMs: number };

const errors: ClientError[] = [];
let installed = false;

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(kind: ClientError["kind"], message: string) {
  errors.push({ at: new Date().toISOString(), kind, message: message.slice(0, MAX_MESSAGE) });
  if (errors.length > MAX) errors.splice(0, errors.length - MAX);
}

export function installClientSignals(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    const where = e.filename ? ` (${e.filename.replace(location.origin, "")}:${e.lineno}:${e.colno})` : "";
    push("error", `${e.message || describe(e.error)}${where}`);
  });
  window.addEventListener("unhandledrejection", (e) => push("rejection", describe(e.reason)));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    try {
      push("console", args.map(describe).join(" "));
    } catch {
      /* never let the collector break logging */
    }
    original.apply(console, args);
  };
}

export function recentClientErrors(): ClientError[] {
  return errors.slice();
}

/* Images, stylesheets and media: an avatar that 404s is how a creator with no
   stored picture renders (the initials show instead), and a share report has a
   dozen of them, which buried the one failed API call worth reading. A missing
   picture is in the screenshot anyway. */
const IGNORED_INITIATORS = new Set(["img", "image", "css", "link", "icon", "video", "audio", "track", "input"]);

/**
 * Same-origin requests that answered 400 or worse, from the browser's own
 * resource timing: API calls, scripts and page loads. Path only: query strings
 * can carry ids and search text the report does not need. responseStatus is
 * Chromium-only (109+); elsewhere this is empty rather than wrong.
 */
export function recentFailedRequests(): FailedRequest[] {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return [];
  const origin = location.origin;
  const navStart = performance.timeOrigin;
  return (performance.getEntriesByType("resource") as (PerformanceResourceTiming & { responseStatus?: number })[])
    .filter((e) => (e.responseStatus ?? 0) >= 400 && e.name.startsWith(origin) && !IGNORED_INITIATORS.has(e.initiatorType))
    .slice(-MAX)
    .map((e) => ({
      at: new Date(navStart + e.startTime).toISOString(),
      path: new URL(e.name).pathname.slice(0, 300),
      status: e.responseStatus ?? 0,
      durationMs: Math.round(e.duration),
    }));
}

/** For tests. */
export function resetClientSignals(): void {
  errors.length = 0;
}
