"use client";

import { useState } from "react";
import { Check, ListChecks, Music, X } from "lucide-react";
import { formatCompact, formatFull } from "@/lib/format";
import { statusFor, type TrackerStatus } from "@/lib/trackers/metrics";

type DemoWindow = "24h" | "7d" | "30d";

const WINDOWS: { key: DemoWindow; label: string; hours: number }[] = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "7d", label: "7 days", hours: 7 * 24 },
  { key: "30d", label: "30 days", hours: 30 * 24 },
];

const SOUNDS: { title: string; artist: string; tone: string; series: Record<DemoWindow, number[]> }[] = [
  {
    title: "Demo Song",
    artist: "Demo Artist",
    tone: "lp-tone-blue",
    series: {
      "24h": [45700, 46100, 46500, 46900, 47400, 47800, 48200],
      "7d": [30000, 32800, 35500, 38300, 41000, 43500, 45900, 48200],
      "30d": [6100, 9800, 14500, 19900, 25000, 30200, 35400, 40100, 44600, 48200],
    },
  },
  {
    title: "Sample Hook (Sped Up)",
    artist: "Sample Band",
    tone: "lp-tone-pink",
    series: {
      "24h": [12500, 12570, 12640, 12700, 12770, 12840, 12900],
      "7d": [8800, 9400, 10000, 10600, 11200, 11800, 12400, 12900],
      "30d": [2400, 3500, 4700, 5900, 7100, 8300, 9500, 10700, 11800, 12900],
    },
  },
  {
    title: "Placeholder Anthem",
    artist: "Test Artist",
    tone: "lp-tone-orange",
    series: {
      "24h": [31620, 31600, 31580, 31560, 31540, 31520, 31500],
      "7d": [31300, 31380, 31450, 31520, 31580, 31620, 31600, 31500],
      "30d": [29100, 29400, 29700, 30000, 30300, 30600, 30900, 31100, 31300, 31500],
    },
  },
];

const STATUS: Record<TrackerStatus, { label: string; tone: string }> = {
  viral: { label: "Viral", tone: "lp-tone-green" },
  trending: { label: "Trending", tone: "lp-tone-blue" },
  stable: { label: "Stable", tone: "" },
  declining: { label: "Declining", tone: "lp-tone-orange" },
  unknown: { label: "Waiting", tone: "" },
};

function sparkPath(values: number[], w: number, h: number): { line: string; area: string } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

function CardHead({ icon, tone, title, sub }: { icon: React.ReactNode; tone: string; title: string; sub: string }) {
  return (
    <>
      <div className="lp-card-head">
        <div className="lp-card-title-row">
          <span className={`lp-icon-tile ${tone}`} aria-hidden>
            {icon}
          </span>
          <h3 className="lp-h3">{title}</h3>
        </div>
        <span className="lp-demo-badge">Demo data</span>
      </div>
      <p className="lp-card-sub">{sub}</p>
    </>
  );
}

export function TrackerDemo() {
  const [win, setWin] = useState<DemoWindow>("7d");
  const current = WINDOWS.find((w) => w.key === win) ?? WINDOWS[1];

  return (
    <article className="lp-card lp-tone-blue">
      <CardHead
        icon={<Music size={20} />}
        tone="lp-tone-blue"
        title="Sound trackers"
        sub="Track a TikTok sound and see how many videos use it, read on a schedule."
      />

      <div className="lp-seg" role="group" aria-label="Change window">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            className="lp-seg-btn lp-tone-blue"
            aria-pressed={win === w.key}
            onClick={() => setWin(w.key)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <ul className="lp-sounds">
        {SOUNDS.map((s) => {
          const values = s.series[win];
          const first = values[0];
          const last = values[values.length - 1];
          const added = last - first;
          const status = STATUS[statusFor(added / current.hours)];
          const { line, area } = sparkPath(values, 96, 32);
          return (
            <li key={s.title} className={`lp-sound ${s.tone}`}>
              <span className="lp-sound-cover" aria-hidden>
                <Music size={18} />
              </span>
              <div className="lp-sound-meta">
                <p className="lp-sound-title">{s.title}</p>
                <p className="lp-sound-artist">{s.artist}</p>
              </div>
              <svg className="lp-spark" viewBox="0 0 96 32" aria-hidden>
                <path d={area} fill="var(--lp-soft)" />
                <path d={line} fill="none" stroke="var(--lp-c)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="lp-sound-figs">
                <p className="lp-sound-uses">{formatFull(last)} uses</p>
                <p className="lp-sound-delta" data-falling={added < 0 || undefined}>
                  {added >= 0 ? "+" : "−"}
                  {formatFull(Math.abs(added))} in {current.label}
                </p>
              </div>
              <span className={`lp-status ${status.tone}`}>{status.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="lp-caption">
        Status follows the rule the app uses: viral at 100 or more new uses an hour across the
        window, trending at 10 or more, declining when uses fall.
      </p>
    </article>
  );
}

type Decision = "PENDING" | "APPROVED" | "REJECTED";

const PEOPLE: { handle: string; initials: string; platform: string; tone: string; followers: number; start: Decision }[] = [
  { handle: "@demo.creator", initials: "DC", platform: "TikTok", tone: "lp-tone-blue", followers: 182000, start: "APPROVED" },
  { handle: "@sample.sounds", initials: "SS", platform: "Instagram", tone: "lp-tone-pink", followers: 64000, start: "PENDING" },
  { handle: "@test.dances", initials: "TD", platform: "TikTok", tone: "lp-tone-blue", followers: 410000, start: "PENDING" },
  { handle: "@placeholder.vlogs", initials: "PV", platform: "YouTube", tone: "lp-tone-orange", followers: 95000, start: "PENDING" },
];

const INITIAL = Object.fromEntries(PEOPLE.map((p) => [p.handle, p.start])) as Record<string, Decision>;

export function ShortlistDemo() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(INITIAL);

  const count = (d: Decision) => PEOPLE.filter((p) => decisions[p.handle] === d).length;
  const approved = count("APPROVED");
  const declined = count("REJECTED");
  const waiting = count("PENDING");
  const pct = (n: number) => `${(n / PEOPLE.length) * 100}%`;
  const changed = PEOPLE.some((p) => decisions[p.handle] !== p.start);

  const decide = (handle: string, d: Decision) =>
    setDecisions((prev) => ({ ...prev, [handle]: prev[handle] === d ? "PENDING" : d }));

  return (
    <article className="lp-card lp-tone-pink">
      <CardHead
        icon={<ListChecks size={20} />}
        tone="lp-tone-pink"
        title="Shared shortlists"
        sub="Send a client one link. They approve or decline each creator, and the decision comes back to your list."
      />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <p className="lp-tally" aria-live="polite">
          <span>
            <strong>{approved}</strong> approved
          </span>
          <span>
            <strong>{declined}</strong> declined
          </span>
          <span>
            <strong>{waiting}</strong> waiting
          </span>
        </p>
        {changed && (
          <button type="button" className="lp-reset" onClick={() => setDecisions(INITIAL)}>
            Reset demo
          </button>
        )}
      </div>
      <div className="lp-meter" aria-hidden>
        <span className="lp-meter-approved" style={{ width: pct(approved) }} />
        <span className="lp-meter-declined" style={{ width: pct(declined) }} />
      </div>

      <ul className="lp-people">
        {PEOPLE.map((p) => {
          const d = decisions[p.handle];
          return (
            <li key={p.handle} className={`lp-person ${p.tone}`} data-decision={d}>
              <span className="lp-avatar" aria-hidden>
                {p.initials}
              </span>
              <div className="lp-person-meta">
                <p className="lp-person-handle">{p.handle}</p>
                <p className="lp-person-sub">
                  <span className="lp-chip">
                    <span className="lp-dot" aria-hidden />
                    {p.platform}
                  </span>
                  {formatCompact(p.followers)} followers
                </p>
              </div>
              <div className="lp-person-actions">
                <button
                  type="button"
                  className="lp-verdict"
                  data-verdict="APPROVED"
                  aria-pressed={d === "APPROVED"}
                  onClick={() => decide(p.handle, "APPROVED")}
                >
                  <Check size={16} aria-hidden /> {d === "APPROVED" ? "Approved" : "Approve"}
                  <span className="sr-only"> {p.handle}</span>
                </button>
                <button
                  type="button"
                  className="lp-verdict"
                  data-verdict="REJECTED"
                  aria-pressed={d === "REJECTED"}
                  onClick={() => decide(p.handle, "REJECTED")}
                >
                  <X size={16} aria-hidden /> {d === "REJECTED" ? "Declined" : "Decline"}
                  <span className="sr-only"> {p.handle}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
