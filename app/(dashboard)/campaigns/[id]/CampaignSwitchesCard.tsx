"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/ds";
import { SWITCHES_OFF, type CampaignSwitch, type CampaignSwitches } from "@/lib/campaigns/rulesShape";

/** What each switch does, in the order the card lists them. */
const SWITCHES: { key: CampaignSwitch; label: string; hint: string; on: string; off: string }[] = [
  {
    key: "allowBoostCodes",
    label: "Ask creators for a boost code",
    hint: "Adds an optional Boost code field (Spark Ads or partnership-ad code, with an expiry) to this campaign's submit form in the creator portal, and Add boost code on each submission. Codes already given stay listed either way.",
    on: "Creators can now add boost codes",
    off: "Boost codes are off for this campaign",
  },
  {
    key: "allowExclusions",
    label: "Exclude flagged posts from totals, with a reason",
    hint: "Adds Exclude from totals to the view-check dialog. The post leaves totals, charts and the share report, and moves to Removed with the reason; Restore puts it back.",
    on: "Reviewers can now exclude flagged posts",
    off: "Excluding flagged posts is off",
  },
];

type Load = "loading" | "ready" | "not-ready" | "failed";

/**
 * Settings → Optional features: per-campaign switches, each off until the
 * agency turns it on (PATCH /api/campaigns/[id]/rules). Read-only for a role
 * that cannot edit the campaign; the route refuses it either way.
 */
export function CampaignSwitchesCard({ campaignId }: { campaignId: string }) {
  const [values, setValues] = useState<CampaignSwitches>(SWITCHES_OFF);
  const [load, setLoad] = useState<Load>("loading");
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState<CampaignSwitch | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/${campaignId}/rules`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!live) return;
        setLoad(data?.ready === true ? "ready" : "not-ready");
        setCanEdit(data?.canEdit === true);
        setValues({ allowBoostCodes: data?.allowBoostCodes === true, allowExclusions: data?.allowExclusions === true });
      })
      .catch(() => live && setLoad("failed"));
    return () => { live = false; };
  }, [campaignId]);

  const change = async (key: CampaignSwitch, next: boolean) => {
    const spec = SWITCHES.find((s) => s.key === key)!;
    setValues((v) => ({ ...v, [key]: next }));
    setSaving(key);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? "Your role can't change this setting." : body.error ?? "Couldn't save. Try again.");
      }
      toast.success(next ? spec.on : spec.off);
    } catch (e) {
      setValues((v) => ({ ...v, [key]: !next }));
      toast.error(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const note =
    load === "not-ready" ? "Not available on this database yet."
    : load === "failed" ? "Couldn't load these settings. Reload the page to try again."
    : load === "ready" && !canEdit ? "Your role can see these settings but not change them."
    : null;
  const disabled = load !== "ready" || !canEdit || saving !== null;

  return (
    <SectionCard title="Optional features" description="Off until you switch them on, for this campaign only.">
      {note && (
        <p role={load === "failed" ? "alert" : undefined} style={{ fontSize: "var(--cc-t-12)", color: load === "failed" ? "var(--cc-danger)" : "var(--cc-text-muted)", margin: "0 0 12px" }}>
          {note}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: load === "not-ready" || load === "failed" ? 0.6 : 1 }}>
        {SWITCHES.map((s) => (
          <label key={s.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: disabled ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={values[s.key]}
              disabled={disabled}
              onChange={(e) => void change(s.key, e.target.checked)}
              aria-labelledby={`switch-label-${s.key}`}
              aria-describedby={`switch-hint-${s.key}`}
              data-testid={`switch-${s.key}`}
              style={{ marginTop: 2, accentColor: "var(--cc-primary)", cursor: "inherit" }}
            />
            <span>
              <span id={`switch-label-${s.key}`} style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{s.label}</span>
              <span id={`switch-hint-${s.key}`} style={{ display: "block", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", lineHeight: 1.5 }}>
                {s.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </SectionCard>
  );
}
