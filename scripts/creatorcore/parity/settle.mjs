/**
 * Waits for a Bubble page to stop changing, rather than sleeping a fixed 8s on
 * every one of 180 captures.
 *
 * MEASURED, not assumed (2026-09-13, /dashboard?tab=Campaigns, 1600x1000):
 *
 *   networkidle only        ready=3749ms  total=28752ms  7/7 landmarks, pitch=48
 *   mutation-quiet 600ms    ready=2202ms  total= 5588ms  7/7 landmarks, pitch=48
 *   mutation-quiet 400ms    ready=2162ms  total= 4344ms  7/7 landmarks, pitch=48
 *
 * `networkidle` NEVER FIRES here -- this app holds a connection open, so the
 * wait always runs to its timeout and contributes nothing but 23 seconds. It is
 * deliberately not used. DOM-mutation stability reaches an identical
 * measurement in a fifth of the time, which is the difference between a 17
 * minute run and an hour.
 *
 * The fixed timeout is a CEILING, never the mechanism.
 */
export async function settle(page, { quietMs = 600, graceMs = 300, timeout = 20_000 } = {}) {
  const started = Date.now();

  try {
    await page.waitForFunction(
      (quiet) =>
        new Promise((resolve) => {
          let timer = setTimeout(() => resolve(true), quiet);
          const obs = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              obs.disconnect();
              resolve(true);
            }, quiet);
          });
          obs.observe(document.body, {
            childList: true, subtree: true, attributes: true, characterData: true,
          });
          // A perpetually animating page (a spinner, a marquee) would otherwise
          // never go quiet. Cap it and measure anyway; harness health reports a
          // low resolution rate if the result is unusable.
          setTimeout(() => {
            obs.disconnect();
            resolve(true);
          }, quiet * 8);
        }),
      quietMs,
      { timeout }
    );
  } catch {
    /* Ceiling hit. Measure what is there rather than dropping the surface. */
  }

  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(graceMs);
  return Date.now() - started;
}
