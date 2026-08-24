import { formatDateAbs, formatDateTimeAbs } from "@/lib/format";

/**
 * These dates are rendered on both sides of the wire -- the server streams the
 * HTML and the browser renders the same component again to hydrate it. If the
 * two machines format an instant differently, React reports a hydration
 * mismatch and the public client report throws on every load, which is what
 * production was doing: it served "21 Aug 2026" for a post that a reader five
 * and a half hours ahead called "22 Aug 2026".
 *
 * So the property under test is not the wording. It is that the output depends
 * on the instant alone and not on where the code is running.
 */
describe("absolute dates do not depend on the reader's timezone", () => {
  /* 20:00 UTC is already the next day in Asia/Calcutta (+05:30) and still the
     previous evening in America/New_York (-04:00), so a formatter that leaks
     the local zone gives three different answers for this one instant. */
  const LATE_IN_THE_DAY = "2026-08-21T20:00:00.000Z";

  it("names the UTC day, whatever zone the process is in", () => {
    expect(formatDateAbs(LATE_IN_THE_DAY)).toBe("21 Aug 2026");
  });

  it("names the UTC time too, so a timestamp does not drift with the reader", () => {
    expect(formatDateTimeAbs(LATE_IN_THE_DAY)).toBe("21 Aug 2026, 20:00");
  });

  it("agrees with what an explicitly-UTC formatter would print", () => {
    /* The check that survives being run on a UTC machine, where hardcoding the
       expected string above proves nothing. */
    for (const iso of [
      "2026-01-01T00:00:00.000Z",
      "2026-06-30T23:59:59.000Z",
      "2026-12-31T18:30:00.000Z",
    ]) {
      const reference = new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      expect(formatDateAbs(iso)).toBe(reference);
    }
  });

  it("still refuses to invent a date out of nothing", () => {
    expect(formatDateAbs(null)).toBe("—");
    expect(formatDateAbs("not a date")).toBe("—");
    expect(formatDateTimeAbs(undefined)).toBe("—");
  });
});
