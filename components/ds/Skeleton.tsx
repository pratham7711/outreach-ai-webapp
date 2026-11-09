import type { CSSProperties } from "react";

type Length = number | string;

const toCss = (v: Length | undefined) => (typeof v === "number" ? `${v}px` : v);

/**
 * A placeholder block that keeps the shape it is given.
 *
 * The library's Skeleton takes only variant/width/height and drops every other
 * prop, so the 109 call sites passing `borderRadius` were all drawn with its
 * default `text` variant: a 9999px pill. A loading tile came out as a stadium
 * and a 300px chart placeholder as a giant capsule. This keeps the library's
 * shimmer (the `.ui-skeleton` class) and puts the radius back.
 *
 * `borderRadius` is accepted as an alias of `radius` so a call site moves over
 * by changing its import and nothing else. With neither, a text-height line
 * gets a small corner and anything taller the control corner.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius,
  borderRadius,
  circle = false,
  className,
  style,
}: {
  width?: Length;
  height?: Length;
  radius?: Length;
  borderRadius?: Length;
  /** A round placeholder, e.g. for an avatar. Same as radius="50%". */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const fallback = typeof height === "number" && height <= 20 ? "var(--cc-r-xs)" : "var(--cc-r-control)";
  return (
    <div
      aria-hidden="true"
      className={`ui-skeleton${className ? ` ${className}` : ""}`}
      style={{
        width: toCss(width),
        height: toCss(height),
        borderRadius: circle ? "50%" : (toCss(radius ?? borderRadius) ?? fallback),
        ...style,
      }}
    />
  );
}
