"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, Skeleton } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { apiFetch } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";

type Settings = {
  readCadence: "hourly" | "4hourly" | "daily";
  chartGranularity: "hourly" | "4hourly" | "daily" | "weekly";
  retentionDays: number;
  effectiveChartGranularity: string;
};

/**
 * Two controls, kept visibly apart.
 *
 * They look like one "granularity" setting and are not. Reading is bought from a
 * browser on a rented box at about ten seconds a sound; charting is a database
 * query over rows that already exist. Someone choosing "hourly" to get a
 * smoother line should not be quietly tripling an operational cost, so the
 * copy for each says plainly what it spends.
 */

const READ_OPTIONS: { value: Settings["readCadence"]; label: string; hint: string }[] = [
  { value: "hourly", label: "Every hour", hint: "Fastest to notice a spike. 24 reads per sound per day." },
  { value: "4hourly", label: "Every 4 hours", hint: "The default. Six reads a day is enough to catch a trend forming." },
  { value: "daily", label: "Once a day", hint: "Cheapest. Enough for catalogue tracking, too slow for a launch." },
];

const CHART_OPTIONS: { value: Settings["chartGranularity"]; label: string; hint: string }[] = [
  { value: "hourly", label: "Hourly", hint: "Only meaningful if you also read hourly." },
  { value: "4hourly", label: "4-hourly", hint: "Every reading plotted, at the default cadence." },
  { value: "daily", label: "Daily", hint: "The default, and what the reference product shows." },
  { value: "weekly", label: "Weekly", hint: "Smoothest. Good for a year-long view of a back catalogue." },
];

export function TrackerSettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Settings>("/api/settings/trackers")
      .then(setSettings)
      .catch((e) => toast.error(errorMessage(e, "Could not load tracker settings")))
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      setSaving(true);
      try {
        const next = await apiFetch<Settings>("/api/settings/trackers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        setSettings(next);
        toast.success("Saved");
      } catch (e) {
        toast.error(errorMessage(e, "Could not save"));
      } finally {
        setSaving(false);
      }
    },
    []
  );

  if (loading) {
    return (
      <Card variant="outlined">
        <Skeleton width={200} height={18} />
        <div style={{ marginTop: 12 }}><Skeleton width="100%" height={80} /></div>
      </Card>
    );
  }
  if (!settings) return null;

  const clamped = settings.effectiveChartGranularity !== settings.chartGranularity;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Section
        title="Read cadence"
        blurb="How often we check each tracked sound on TikTok. Every reading is a real page load on a machine outside India — this is the setting that costs something."
      >
        <RadioRow
          name="readCadence"
          options={READ_OPTIONS}
          value={settings.readCadence}
          disabled={saving}
          onChange={(v) => save({ readCadence: v as Settings["readCadence"] })}
        />
      </Section>

      <Section
        title="Chart granularity"
        blurb="How densely the charts are drawn. This only groups readings you already have, so changing it costs nothing and never triggers extra reads."
      >
        <RadioRow
          name="chartGranularity"
          options={CHART_OPTIONS}
          value={settings.chartGranularity}
          disabled={saving}
          onChange={(v) => save({ chartGranularity: v as Settings["chartGranularity"] })}
        />
        {clamped ? (
          <div
            role="status"
            style={{
              marginTop: 10, fontSize: 12, color: "var(--cc-text)",
              borderLeft: "3px solid var(--cc-warning)", paddingLeft: 10,
            }}
          >
            Charts are being drawn <strong>{settings.effectiveChartGranularity}</strong>, not{" "}
            {settings.chartGranularity} — you cannot plot points more often than they are read.
            Raise the read cadence above to use this setting.
          </div>
        ) : null}
      </Section>

      <Section
        title="History kept"
        blurb="How far back readings are retained for charting."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="number"
            min={7}
            max={1095}
            defaultValue={settings.retentionDays}
            disabled={saving}
            aria-label="Days of history to keep"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== settings.retentionDays) save({ retentionDays: v });
            }}
            style={{
              width: 100, padding: "8px 10px", borderRadius: 8,
              border: "1px solid var(--cc-border)", background: "var(--cc-card)",
              color: "var(--cc-text)", fontSize: 14,
            }}
          />
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            days (7–1095). The reference product shows about a year.
          </span>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <Card variant="outlined">
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>{title}</h2>
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 14 }}>{blurb}</p>
      {children}
    </Card>
  );
}

function RadioRow({
  name, options, value, disabled, onChange,
}: {
  name: string;
  options: { value: string; label: string; hint: string }[];
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {options.map((o) => (
        <label
          key={o.value}
          style={{
            display: "flex", gap: 10, alignItems: "flex-start", cursor: disabled ? "default" : "pointer",
            padding: "10px 12px", borderRadius: 10,
            border: `1px solid ${value === o.value ? "var(--cc-primary)" : "var(--cc-border)"}`,
            background: value === o.value ? "var(--cc-primary-light)" : "transparent",
          }}
        >
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{o.label}</span>
            <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)" }}>{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
