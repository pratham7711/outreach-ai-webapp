"use client";

import { useState } from "react";
import { Check, ListChecks, Music, X } from "lucide-react";
import { Button } from "@/components/ds/Button";
import { SectionCard } from "@/components/ds/SectionCard";
import { Sparkline } from "@/components/ds/Sparkline";
import { PlatformTag, StatusBadge, type StatusTone } from "@/components/ds/StatusBadge";
import { formatCompact, formatFull } from "@/lib/format";
import { statusFor, type TrackerStatus } from "@/lib/trackers/metrics";
import { CountUp } from "./LandingMotion";

type DemoWindow = "24h" | "7d" | "30d";

const WINDOWS: { key: DemoWindow; label: string; hours: number }[] = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "7d", label: "7 days", hours: 7 * 24 },
  { key: "30d", label: "30 days", hours: 30 * 24 },
];

const SOUNDS: { title: string; artist: string; series: Record<DemoWindow, number[]> }[] = [
  {
    title: "Demo Song",
    artist: "Demo Artist",
    series: {
      "24h": [45700, 46100, 46500, 46900, 47400, 47800, 48200],
      "7d": [30000, 32800, 35500, 38300, 41000, 43500, 45900, 48200],
      "30d": [6100, 9800, 14500, 19900, 25000, 30200, 35400, 40100, 44600, 48200],
    },
  },
  {
    title: "Sample Hook (Sped Up)",
    artist: "Sample Band",
    series: {
      "24h": [12500, 12570, 12640, 12700, 12770, 12840, 12900],
      "7d": [8800, 9400, 10000, 10600, 11200, 11800, 12400, 12900],
      "30d": [2400, 3500, 4700, 5900, 7100, 8300, 9500, 10700, 11800, 12900],
    },
  },
  {
    title: "Placeholder Anthem",
    artist: "Test Artist",
    series: {
      "24h": [31620, 31600, 31580, 31560, 31540, 31520, 31500],
      "7d": [31300, 31380, 31450, 31520, 31580, 31620, 31600, 31500],
      "30d": [29100, 29400, 29700, 30000, 30300, 30600, 30900, 31100, 31300, 31500],
    },
  },
];

const STATUS: Record<TrackerStatus, { label: string; tone: StatusTone }> = {
  viral: { label: "Viral", tone: "success" },
  trending: { label: "Trending", tone: "info" },
  stable: { label: "Stable", tone: "neutral" },
  declining: { label: "Declining", tone: "warning" },
  unknown: { label: "Waiting", tone: "neutral" },
};

const demoBadge = <StatusBadge tone="neutral">Demo data</StatusBadge>;

export function TrackerDemo() {
  const [win, setWin] = useState<DemoWindow>("7d");
  /* Lines redraw only after someone changes the window, never on load. */
  const [touched, setTouched] = useState(false);
  const current = WINDOWS.find((w) => w.key === win) ?? WINDOWS[1];

  return (
    <SectionCard
      icon={Music}
      title="Sound trackers"
      action={demoBadge}
      className="mb-app-card"
    >
      <div role="group" aria-label="Change window" className="cc-segmented mb-seg">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            className="cc-segmented-btn"
            aria-pressed={win === w.key}
            onClick={() => {
              setWin(w.key);
              setTouched(true);
            }}
          >
            {w.label}
          </button>
        ))}
      </div>

      <ul className="mb-rows">
        {SOUNDS.map((s) => {
          const values = s.series[win];
          const last = values[values.length - 1];
          const added = last - values[0];
          const status = STATUS[statusFor(added / current.hours)];
          return (
            <li key={s.title} className="mb-row">
              <span className="mb-cover" aria-hidden>
                <Music size={16} />
              </span>
              <div className="mb-row-meta">
                <p className="mb-row-title">{s.title}</p>
                <p className="mb-row-sub">{s.artist}</p>
              </div>
              <span className="mb-row-spark" key={touched ? win : "load"} data-draw={touched ? "" : undefined}>
                <Sparkline values={values} width={88} height={28} />
              </span>
              <div className="mb-row-figs">
                <p className="mb-row-title">
                  <CountUp value={last} format={formatFull} /> uses
                </p>
                <p className="mb-row-sub">
                  {added >= 0 ? "+" : "−"}
                  {formatFull(Math.abs(added))} in {current.label}
                </p>
              </div>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

type Decision = "PENDING" | "APPROVED" | "REJECTED";

const PEOPLE: { handle: string; initials: string; platform: string; followers: number; start: Decision }[] = [
  { handle: "@demo.creator", initials: "DC", platform: "TIKTOK", followers: 182000, start: "APPROVED" },
  { handle: "@sample.sounds", initials: "SS", platform: "INSTAGRAM", followers: 64000, start: "PENDING" },
  { handle: "@test.dances", initials: "TD", platform: "TIKTOK", followers: 410000, start: "PENDING" },
  { handle: "@placeholder.vlogs", initials: "PV", platform: "YOUTUBE", followers: 95000, start: "PENDING" },
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
    <SectionCard
      icon={ListChecks}
      title="Shared shortlist"
      action={demoBadge}
      className="mb-app-card"
    >
      <div className="mb-tally-row">
        <p className="mb-tally" aria-live="polite">
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
          <Button size="sm" variant="ghost" onClick={() => setDecisions(INITIAL)}>
            Reset demo
          </Button>
        )}
      </div>
      <div className="mb-meter" aria-hidden>
        <span className="mb-meter-approved" style={{ width: pct(approved) }} />
        <span className="mb-meter-declined" style={{ width: pct(declined) }} />
      </div>

      <ul className="mb-rows">
        {PEOPLE.map((p) => {
          const d = decisions[p.handle];
          return (
            <li key={p.handle} className="mb-row mb-person" data-decision={d}>
              <span className="mb-avatar" aria-hidden>
                {p.initials}
              </span>
              <div className="mb-row-meta">
                <p className="mb-row-title">{p.handle}</p>
                <p className="mb-row-sub mb-person-sub">
                  <PlatformTag platform={p.platform} />
                  <span>{formatCompact(p.followers)} followers</span>
                </p>
              </div>
              <div className="mb-person-actions">
                <Button
                  size="sm"
                  variant={d === "APPROVED" ? "primary" : "secondary"}
                  aria-pressed={d === "APPROVED"}
                  iconLeft={<Check size={15} aria-hidden="true" />}
                  onClick={() => decide(p.handle, "APPROVED")}
                >
                  {d === "APPROVED" ? "Approved" : "Approve"}
                  <span className="sr-only"> {p.handle}</span>
                </Button>
                <Button
                  size="sm"
                  variant={d === "REJECTED" ? "danger" : "secondary"}
                  aria-pressed={d === "REJECTED"}
                  iconLeft={<X size={15} aria-hidden="true" />}
                  onClick={() => decide(p.handle, "REJECTED")}
                >
                  {d === "REJECTED" ? "Declined" : "Decline"}
                  <span className="sr-only"> {p.handle}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
