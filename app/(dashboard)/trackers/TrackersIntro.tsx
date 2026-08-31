"use client";
import { Music, Clock, TrendingUp } from "lucide-react";
import { Button } from "@/components/ds";

/**
 * What someone sees before they have tracked anything.
 *
 * A blank slate here is worse than usual, because the two things most likely to
 * be misread are both properties of how this feature works rather than bugs:
 * nothing appears for a few hours after you add a sound, and no trend appears
 * until there are two readings. Both look like breakage if nobody said them
 * first, and the support question they generate is "the tracker is broken".
 *
 * So this is not decoration. Each step exists to pre-empt one wrong conclusion.
 */
export function TrackersIntro({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 12,
        padding: 28,
        maxWidth: 720,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
        Watch a sound climb — or catch it stalling
      </h2>
      <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 20, maxWidth: 560 }}>
        Track any TikTok audio and we read its use count on a schedule, so a trend is visible
        days before it peaks — and a sound losing uses is just as visible.
      </p>

      <ol style={{ listStyle: "none", padding: 0, margin: "0 0 22px", display: "flex", flexDirection: "column", gap: 14 }}>
        <Step
          icon={<Music size={16} />}
          title="Paste a link"
          body="Open the sound's page on TikTok — tap the spinning record on any video — and paste its URL. We read the sound from the link; you don't type an ID."
        />
        <Step
          icon={<Clock size={16} />}
          title="The first reading lands within a few hours"
          body="Readings arrive on a schedule, not the moment you add a sound. A new tracker showing “awaiting first reading” is working correctly."
        />
        <Step
          icon={<TrendingUp size={16} />}
          title="Trends need two readings"
          body="A single reading is a number, not a direction. Change and status appear once there are two points to compare."
        />
      </ol>

      <Button variant="primary" onClick={onAdd}>Track your first sound</Button>
    </div>
  );
}

function Step({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span
        aria-hidden
        style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--cc-primary-light)", color: "var(--cc-primary)",
        }}
      >
        {icon}
      </span>
      <span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{title}</span>
        <span style={{ display: "block", fontSize: 13, color: "var(--cc-text-muted)" }}>{body}</span>
      </span>
    </li>
  );
}

/**
 * What the status words mean, available permanently rather than only on first
 * run — the thresholds are real and nobody can guess them.
 */
export function StatusLegend() {
  const rows = [
    ["Viral", "100+ new uses an hour"],
    ["Trending", "10–99 new uses an hour"],
    ["Stable", "under 10 an hour"],
    ["Declining", "losing uses — creators deleting or re-sounding videos"],
    ["No data", "fewer than two readings in this window"],
    ["Not updating", "readings have stopped; the count shown is the last known one"],
  ];
  return (
    <div style={{ fontSize: 12, color: "var(--cc-text-muted)", lineHeight: 1.7 }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <strong style={{ color: "var(--cc-text)" }}>{k}</strong> — {v}
        </div>
      ))}
    </div>
  );
}
