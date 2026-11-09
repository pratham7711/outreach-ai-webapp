"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Banner } from "@/components/ds/Banner";
import { SectionCard } from "@/components/ds/SectionCard";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { Switch } from "@/components/ds/Switch";

type AuditLogToggleCardProps = {
  initialEnabled: boolean;
  planName: string;
  /** Whether this user holds `settings:*`. The PATCH has always refused
      anybody else with a 403; the switch was live for them regardless, so it
      flipped optimistically and then snapped back with an error. */
  canManage: boolean;
};

function formatLabel(value: string) {
  return value
    .split(/[_\-. ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function AuditLogToggleCard({ initialEnabled, planName, canManage }: AuditLogToggleCardProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function syncSetting() {
      try {
        const res = await fetch("/api/settings/audit-log", { signal: controller.signal });
        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        if (active && typeof data?.enabled === "boolean") {
          setEnabled(data.enabled);
        }
      } catch {
        // Keep the optimistic server-rendered state if sync fails.
      } finally {
        if (active) setLoading(false);
      }
    }

    syncSetting();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  async function handleToggle(nextEnabled: boolean) {
    if (saving || !canManage) return;

    const previous = enabled;
    setError(null);
    setEnabled(nextEnabled);
    setSaving(true);

    try {
      const res = await fetch("/api/settings/audit-log", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Unable to update audit log setting");
      }

      const body = await res.json().catch(() => null);
      if (typeof body?.enabled === "boolean") {
        setEnabled(body.enabled);
      }
    } catch (err) {
      setEnabled(previous);
      setError(err instanceof Error ? err.message : "Unable to update audit log setting");
    } finally {
      setSaving(false);
    }
  }

  const isBusy = loading || saving;

  return (
    <SectionCard
      icon={ShieldCheck}
      title="Audit log recording"
      description="Turn workspace audit logging on or off for this organization."
      className="cc-audit-toggle"
    >
      <div className="cc-pref-row">
        <div className="cc-pref-row-text">
          <div className="cc-pref-row-title" id="cc-audit-toggle-label">
            Record audit events
          </div>
          <div className="cc-pref-row-desc">
            {isBusy
              ? loading
                ? "Syncing current setting…"
                : "Saving change…"
              : enabled
                ? "Audit events are being recorded."
                : "Audit events are currently paused."}
          </div>
          {!canManage ? <div className="cc-pref-row-desc">Only owners and admins can change this.</div> : null}
        </div>
        <Switch
          checked={enabled}
          onChange={handleToggle}
          disabled={isBusy || !canManage}
          aria-labelledby="cc-audit-toggle-label"
        />
      </div>
      <div className="cc-audit-toggle__meta">
        <StatusBadge tone={enabled ? "success" : "warning"}>{enabled ? "On" : "Off"}</StatusBadge>
        <StatusBadge tone="neutral">Plan: {formatLabel(planName)}</StatusBadge>
      </div>
      <Banner tone="info" placement="inline" icon={<ShieldOff />}>
        When disabled, new audit events are not written and the audit log view is blocked until it is turned back on.
      </Banner>
      {error ? (
        <Banner tone="danger" placement="inline" role="alert" title="Audit log update failed.">
          {error}
        </Banner>
      ) : null}
    </SectionCard>
  );
}
