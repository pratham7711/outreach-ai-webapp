"use client";

import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { formatFull } from "@/lib/format";
import { DAYS, PLATFORMS, lastViews, type Filter } from "./landingHeroData";

/* Client-only and after first paint: recharts is ~85 KB gzipped and was the
   largest single thing on the landing page's first load. `.lp-chart` has a fixed
   height in globals.css, so the empty box until it arrives is already the
   chart's size and nothing below it moves. */
const LandingHeroChart = dynamic(() => import("./LandingHeroChart"), { ssr: false });

export function LandingHeroVisual() {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");
  const gradientBase = useId().replace(/:/g, "");
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 479px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const shown = filter === "all" ? PLATFORMS : PLATFORMS.filter((p) => p.key === filter);
  const views = shown.reduce((sum, p) => sum + lastViews(p.key), 0);
  const engagements = shown.reduce((sum, p) => sum + p.engagements, 0);
  const posts = shown.reduce((sum, p) => sum + p.posts, 0);

  const summary = `Views to date over ${DAYS} days on ${posts} posts: ${shown
    .map((p) => `${p.label} ${formatFull(lastViews(p.key))}`)
    .join(", ")}.`;

  const options: { key: Filter; label: string; tone: string }[] = [
    { key: "all", label: "All platforms", tone: "lp-tone-violet" },
    ...PLATFORMS.map((p) => ({ key: p.key, label: p.label, tone: p.tone })),
  ];

  return (
    <figure className="lp-card lp-card-elevated lp-rise lp-rise-3">
      <div className="lp-card-head lp-card-head-spaced">
        <div style={{ minWidth: 0 }}>
          <p className="lp-kpi-label">Campaign · Summer single launch</p>
          <p className="lp-h3">Views across every tracked post</p>
        </div>
        <span className="lp-demo-badge">Demo data</span>
      </div>

      <div className="lp-seg lp-seg-quad" role="group" aria-label="Show platform">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`lp-seg-btn ${o.tone}`}
            aria-pressed={filter === o.key}
            onClick={() => setFilter(o.key)}
          >
            {o.key !== "all" && <span className="lp-dot" aria-hidden />}
            {o.label}
          </button>
        ))}
      </div>

      <dl className="lp-kpis">
        <div>
          <dt className="lp-kpi-label">Views</dt>
          <dd className="lp-kpi-value">{formatFull(views)}</dd>
        </div>
        <div>
          <dt className="lp-kpi-label">Engagements</dt>
          <dd className="lp-kpi-value">{formatFull(engagements)}</dd>
        </div>
        <div>
          <dt className="lp-kpi-label">Posts tracked</dt>
          <dd className="lp-kpi-value">{posts}</dd>
        </div>
      </dl>

      <div className="lp-chart">
        <LandingHeroChart
          shown={shown}
          filter={filter}
          narrow={narrow}
          reduced={reduced}
          summary={summary}
          gradientBase={gradientBase}
        />
      </div>

      <figcaption className="lp-caption" aria-live="polite">
        Demo data, invented for this preview. {summary}
      </figcaption>
    </figure>
  );
}
