/**
 * Start a GET before the component that reads it has mounted, and hand the
 * response to the first reader.
 *
 * The campaign page fetches the campaign and only then mounts its cards, each
 * of which fetched its own data on mount: four requests in a row instead of
 * side by side. The page now calls `startFetch` for those URLs as it mounts,
 * and each card calls `takeFetch`, which returns the request already in
 * flight or, when there is none, a fresh one. A Response body can be read
 * once, so a started request is handed out once and then forgotten; one that
 * nobody takes within `MAX_AGE_MS` is dropped rather than served stale.
 */
const MAX_AGE_MS = 15_000;
const started = new Map<string, { at: number; res: Promise<Response> }>();

export function startFetch(url: string): void {
  const hit = started.get(url);
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return;
  const res = fetch(url);
  res.catch(() => {});
  started.set(url, { at: Date.now(), res });
}

export function takeFetch(url: string): Promise<Response> {
  const hit = started.get(url);
  started.delete(url);
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return hit.res;
  return fetch(url);
}
