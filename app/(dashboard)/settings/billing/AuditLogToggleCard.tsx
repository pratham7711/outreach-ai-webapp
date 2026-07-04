"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ShieldCheck, ShieldOff } from "lucide-react";
import { Alert, Badge, Card, LoadingSpinner, Toggle } from "@pratham7711/ui";

type AuditLogToggleCardProps = {
  initialEnabled: boolean;
  planName: string;
};

function formatLabel(value: string) {
  return value
    .split(/[_\-. ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function AuditLogToggleCard({ initialEnabled, planName }: AuditLogToggleCardProps) {
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
    if (saving) return;

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
    <Card variant="outlined" noPadding>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 240px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(79, 70, 229, 0.08)",
                  color: "var(--cc-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
                  Audit log recording
                </h2>
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Turn workspace audit logging on or off for this organization.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Badge variant={enabled ? "success" : "warning"} size="sm">
                {enabled ? "On" : "Off"}
              </Badge>
              <Badge variant="neutral" size="sm">
                Plan: {formatLabel(planName)}
              </Badge>
              {isBusy && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--cc-text-muted)" }}>
                  <LoadingSpinner size={14} />
                  {loading ? "Syncing current setting" : "Saving change"}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
            <Toggle checked={enabled} onChange={handleToggle} size="md" disabled={isBusy} />
            <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              {enabled ? "Audit events are being recorded" : "Audit events are currently paused"}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--cc-bg)",
            border: "1px solid var(--cc-border)",
          }}
        >
          <ShieldOff size={16} style={{ color: "var(--cc-text-muted)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)", lineHeight: 1.5 }}>
            When disabled, new audit events are not written and the audit log view will be blocked until re-enabled.
          </span>
        </div>

        {error && (
          <Alert variant="danger" title="Audit log update failed" icon={<AlertCircle size={16} />}>
            {error}
          </Alert>
        )}
      </div>
    </Card>
  );
}
