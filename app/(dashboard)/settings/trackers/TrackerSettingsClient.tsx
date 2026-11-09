"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LineChart } from "lucide-react";
import { Field, LoadError, SettingsForm, Skeleton, SectionCard, Banner } from "@/components/ds";
import { MetricHint } from "@/components/ds/MetricHint";
import { ModalOption, ModalOptionList } from "@/components/ds/Modal";
import { useDirty } from "@/lib/useDirty";
import { apiFetch } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";
/* Imported, not restated. This file used to declare its own copy of both
   unions, so narrowing the real ones in lib/trackers/granularity.ts left a
   settings screen still offering cadences the server no longer accepts --
   the failure is silent, because the server just coerces them back. */
import { effectiveChartGranularity, type ReadCadence, type ChartGranularity } from "@/lib/trackers/granularity";

type Settings = {
  readCadence: ReadCadence;
  chartGranularity: ChartGranularity;
  retentionDays: number;
  effectiveChartGranularity: string;
};

type Draft = Pick<Settings, "readCadence" | "chartGranularity">;

/**
 * Two controls, kept visibly apart.
 *
 * They look like one "granularity" setting and are not. Reading is bought from a
 * browser on a rented box at about ten seconds a sound; charting is a database
 * query over rows that already exist. Someone choosing the densest option to get a
 * smoother line should not be quietly tripling an operational cost, so the
 * copy for each says plainly what it spends -- and a choice is only applied
 * when Save is pressed, rather than the moment a row is clicked.
 */

/* Labelled by snapshots per day, because that is the number anyone actually
   has an opinion about — "every 4 hours" and "6 a day" are the same setting,
   and only one of them is the question being asked. */
const READ_OPTIONS: { value: ReadCadence; label: string; hint: string }[] = [
  { value: "6hourly", label: "4 a day", hint: "Catches a spike the same day" },
  { value: "12hourly", label: "2 a day", hint: "Default" },
  { value: "daily", label: "1 a day", hint: "Cheapest" },
];

const CHART_OPTIONS: { value: ChartGranularity; label: string; hint: string }[] = [
  { value: "6hourly", label: "6-hourly", hint: "Needs 4 reads a day" },
  { value: "daily", label: "Daily", hint: "Default" },
  { value: "weekly", label: "Weekly", hint: "Smoothest, for long views" },
];

const chartLabel = (v: string) => (CHART_OPTIONS.find((o) => o.value === v)?.label ?? v).toLowerCase();

export function TrackerSettingsClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const dirty = useDirty(saved, draft);

  const take = useCallback((s: Settings) => {
    setSettings(s);
    const d = { readCadence: s.readCadence, chartGranularity: s.chartGranularity };
    setSaved(d);
    setDraft(d);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    apiFetch<Settings>("/api/settings/trackers")
      .then(take)
      .catch((e) => setLoadError(errorMessage(e, "Could not load tracker settings")))
      .finally(() => setLoading(false));
  }, [take]);

  useEffect(() => { load(); }, [load]);

  /* Only the fields that changed go up, so the stored retentionDays (which
     nothing here edits) round-trips untouched. */
  const save = useCallback(async () => {
    if (!saved || !draft) return;
    const patch: Partial<Draft> = {};
    if (draft.readCadence !== saved.readCadence) patch.readCadence = draft.readCadence;
    if (draft.chartGranularity !== saved.chartGranularity) patch.chartGranularity = draft.chartGranularity;
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const next = await apiFetch<Settings>("/api/settings/trackers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      take(next);
      toast.success("Tracker settings saved");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save"));
    } finally {
      setSaving(false);
    }
  }, [saved, draft, take]);

  if (loading) {
    return (
      <SectionCard icon={LineChart} title="Reading and charts">
        <div className="cc-settings-skeleton" aria-busy="true" aria-label="Loading tracker settings">
          <Skeleton width={160} height={14} />
          <Skeleton width="100%" height={168} radius="var(--cc-r-card)" />
          <Skeleton width={160} height={14} />
          <Skeleton width="100%" height={168} radius="var(--cc-r-card)" />
        </div>
      </SectionCard>
    );
  }
  /* Never a blank page. A failed load says so and offers a retry; returning
     null here left the header sitting above nothing at all. */
  if (loadError || !settings || !draft) {
    return (
      <LoadError
        title="Tracker settings could not be loaded"
        description={loadError ?? "The server returned nothing for this workspace."}
        onRetry={load}
      />
    );
  }

  /* What the charts will be drawn at once this is saved: never denser than the
     reads -- the server's own clamp, applied to the choices on screen. */
  const effective = effectiveChartGranularity(draft);
  const clamped = effective !== draft.chartGranularity;

  return (
    <SettingsForm
      icon={LineChart}
      title="Reading and charts"
      description="For every tracked sound"
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      onCancel={() => saved && setDraft(saved)}
      className="cc-tracker-settings"
    >
      <Field
        label={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Read cadence
            <MetricHint
              label="Read cadence"
              what="How many snapshots we take of each tracked sound per day. Each one loads a real page, so this is the setting that costs something."
            />
          </span>
        }
        group
      >
        <RadioRow
          name="readCadence"
          label="Read cadence"
          options={READ_OPTIONS}
          value={draft.readCadence}
          disabled={saving}
          onChange={(v) => setDraft((d) => (d ? { ...d, readCadence: v as ReadCadence } : d))}
        />
      </Field>

      <Field
        label={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Chart granularity
            <MetricHint label="Chart granularity" what="Groups readings you already have. Free to change; never triggers extra reads." />
          </span>
        }
        group
      >
        <RadioRow
          name="chartGranularity"
          label="Chart granularity"
          options={CHART_OPTIONS}
          value={draft.chartGranularity}
          disabled={saving}
          onChange={(v) => setDraft((d) => (d ? { ...d, chartGranularity: v as ChartGranularity } : d))}
        />
      </Field>
      {clamped ? (
        <Banner tone="warning" placement="inline" role="status">
          Charts show <strong>{chartLabel(effective)}</strong>. Raise the read cadence to plot{" "}
          {chartLabel(draft.chartGranularity)}.
        </Banner>
      ) : null}

      {/* "History kept" is not offered: nothing prunes readings, so the box
          could only ever be read-only. The stored retentionDays is untouched
          and still round-trips through save, for the pruning job to read. */}
    </SettingsForm>
  );
}

/** The choices as option rows, each a real radio, matching the dialogs' option lists. */
function RadioRow({
  name, label, options, value, disabled, onChange,
}: {
  name: string;
  label: string;
  options: { value: string; label: string; hint: string }[];
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="cc-settings-options">
      <ModalOptionList>
        {options.map((o) => (
          <ModalOption
            key={o.value}
            title={o.label}
            description={o.hint}
            disabled={disabled}
            control={
              <input
                type="radio"
                className="cc-radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                disabled={disabled}
                onChange={() => onChange(o.value)}
              />
            }
          />
        ))}
      </ModalOptionList>
    </div>
  );
}
