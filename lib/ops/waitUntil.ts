/**
 * How long past its own deadline a cron run keeps waiting for work in flight.
 *
 * Every sweep here stops STARTING reads at a four-minute deadline, but a read
 * already started is awaited for as long as it takes, and an await that never
 * settles holds the run until the platform kills the function. MEASURED on
 * production 2026-10-01 in the creator sweep: three of the first five pooled
 * runs stopped writing two to three minutes in and sat silent until the 300s
 * kill -- no completion line, no summary, no alert, because every worker was
 * parked on an await that never came back. lib/creators/snapshot.ts added this
 * backstop then; the post sweep and the sound sweep have the same shape.
 *
 * 240s deadline + 30s leaves the route's 300s maxDuration room for its own
 * cleanup (closing sandboxes, flushing the source breaker) and its response.
 */
export const ABANDON_AFTER_DEADLINE_MS = 30_000;

export type Waited<T> = { settled: true; value: T } | { settled: false };

/**
 * Waits for `work` until the wall-clock time `at` (epoch ms), then stops
 * waiting and says so. The work is not cancelled -- nothing here can cancel a
 * fetch someone else started -- it is only no longer awaited.
 *
 * A rejection before `at` propagates exactly as `await work` would. One after
 * `at` is swallowed: nobody is listening any more, and an unhandled rejection
 * would surface as a process-level error in a run that already finished.
 */
export async function waitUntil<T>(work: Promise<T>, at: number): Promise<Waited<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = work.then((value) => ({ settled: true as const, value }));
  done.catch(() => {});
  try {
    return await Promise.race([
      done,
      new Promise<Waited<T>>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), Math.max(0, at - Date.now()));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
