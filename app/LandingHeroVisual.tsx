"use client";

import { motion, useReducedMotion } from "framer-motion";

const SERIES = [18, 26, 22, 41, 38, 62, 74, 71, 96, 118, 142, 171];
const WIDTH = 520;
const HEIGHT = 220;
const PAD = 12;

function pathFor(values: number[], close: boolean): string {
  const max = Math.max(...values);
  const stepX = (WIDTH - PAD * 2) / (values.length - 1);

  const points = values.map((v, i) => {
    const x = PAD + i * stepX;
    const y = HEIGHT - PAD - (v / max) * (HEIGHT - PAD * 2);
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  if (!close) return line;
  return `${line} L${WIDTH - PAD} ${HEIGHT - PAD} L${PAD} ${HEIGHT - PAD} Z`;
}

export function LandingHeroVisual() {
  const reduced = useReducedMotion();

  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        borderRadius: 16,
        border: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
        padding: 20,
        overflow: "hidden",
        boxShadow: "0 24px 60px -32px rgba(28, 32, 72, 0.35)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/landing/hero.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.1,
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--cc-text-muted)" }}>
              CAMPAIGN VIEWS
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>
              3,240,918
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--cc-text-muted)" }}>
              CPM
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-primary)", fontVariantNumeric: "tabular-nums" }}>
              ₹42
            </div>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="presentation"
          style={{ display: "block", width: "100%", height: "auto" }}
        >
          <defs>
            <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cc-primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--cc-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={PAD}
              x2={WIDTH - PAD}
              y1={PAD + t * (HEIGHT - PAD * 2)}
              y2={PAD + t * (HEIGHT - PAD * 2)}
              stroke="var(--cc-border)"
              strokeWidth="1"
            />
          ))}

          <motion.path
            d={pathFor(SERIES, true)}
            fill="url(#heroFill)"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
          />
          <motion.path
            d={pathFor(SERIES, false)}
            fill="none"
            stroke="var(--cc-primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, ease: "easeInOut" }}
          />
        </svg>
      </div>
    </div>
  );
}
