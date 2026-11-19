"use client";

import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { formatFull } from "@/lib/format";
import { DAYS, PLATFORMS, lastViews, type Filter } from "./landingHeroData";

/* Client-only and after first paint: recharts is ~85 KB gzipped and was the
   largest single thing on the landing page's first load. `.mb-chart` has a fixed
   height in globals.css, so the empty box until it arrives is already the
   chart's size and nothing below it moves. */
const LandingHeroChart = dynamic(() => import("./LandingHeroChart"), { ssr: false });

/** The hero's app card: the campaign views chart as the app draws it. */
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

  const options: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    ...PLATFORMS.map((p) => ({ key: p.key, label: p.label })),
  ];

  return (
    <figure className="cc-section-card mb-app-card mb-hero-card">
      <div className="cc-section-card-head">
        <div className="cc-section-card-heading">
          <BarChart3 aria-hidden="true" className="cc-section-card-icon" strokeWidth={2} />
          <div className="cc-section-card-headtext">
            <p className="cc-section-card-title">Views across every tracked post</p>
            <p className="cc-section-card-desc">Campaign · Summer single launch</p>
          </div>
        </div>
        <div className="cc-section-card-action">
          <StatusBadge tone="neutral">Demo data</StatusBadge>
        </div>
      </div>

      <div className="cc-section-card-body" data-padded>
        <div role="group" aria-label="Show platform" className="cc-segmented mb-seg">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              className="cc-segmented-btn"
              aria-pressed={filter === o.key}
              onClick={() => setFilter(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <dl className="mb-kpis">
          <div>
            <dt className="cc-metric-label">Views</dt>
            <dd className="mb-kpi-value">{formatFull(views)}</dd>
          </div>
          <div>
            <dt className="cc-metric-label">Engagements</dt>
            <dd className="mb-kpi-value">{formatFull(engagements)}</dd>
          </div>
          <div>
            <dt className="cc-metric-label">Posts tracked</dt>
            <dd className="mb-kpi-value">{posts}</dd>
          </div>
        </dl>

        <div className="mb-chart">
          <LandingHeroChart
            shown={shown}
            filter={filter}
            narrow={narrow}
            reduced={reduced}
            summary={summary}
            gradientBase={gradientBase}
          />
        </div>

        <ul className="mb-legend" aria-hidden="true">
          {shown.map((p) => (
            <li key={p.key}>
              <span className="mb-dot" style={{ background: p.color }} />
              {p.label}
            </li>
          ))}
        </ul>

        <figcaption className="mb-caption" aria-live="polite">
          Demo data, invented for this preview. {summary}
        </figcaption>
      </div>
    </figure>
  );
}
