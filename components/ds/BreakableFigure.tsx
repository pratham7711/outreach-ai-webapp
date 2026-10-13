import { Fragment, type ReactNode } from "react";

/**
 * A formatted figure that may wrap, but only between its digit groups.
 *
 * A comma-grouped number has no break opportunity at all -- a comma between two
 * digits is an infix separator in the line-breaking rules -- so a tile too
 * narrow for "1,826,153,478" had two choices and took the bad one: it cut the
 * figure to "1,826,153…", which reads as a different number. MEASURED
 * 2026-10-13 at 390: "340,…" and "28,0…" on the post page, "2,400,…" on the
 * creator page, "1,826,153…" on a roster card (that one at 1440 too).
 *
 * A <wbr> after each separator gives the line breaker somewhere to go, so the
 * figure wraps as "1,826,153," / "478" -- every digit still on screen -- and
 * textContent is unchanged, so a copy, a test or a screen reader still gets the
 * plain number. Anything that is not a grouped number is returned as it came.
 */
export function breakableFigure(text: string): ReactNode {
  if (!/\d,\d/.test(text)) return text;
  const parts = text.split(",");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          ,<wbr />
        </>
      )}
    </Fragment>
  ));
}
