"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@pratham7711/ui";
import { toast } from "sonner";

/**
 * Settings → Metrics.
 *
 * One switch today. It is its own page rather than a row inside General
 * (which is tags and statuses) because turning EMV off is not a display tweak:
 * it removes a column from the posts table and the CSV export, a tile from the
 * campaign and post pages, a column from both analytics tables, and the EMV
 * option from every public share link — including links already sent out.
 */
export function MetricsSettingsClient() {
  const [showEmv, setShowEmv] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/metrics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (!d) return setError(true);
        setShowEmv(d.showEmv !== false);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(
    async (next: boolean) => {
      const previous = showEmv;
      setShowEmv(next); // optimistic; the switch should not lag the finger
      setSaving(true);
      try {
        const res = await fetch("/api/settings/metrics", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showEmv: next }),
        });
        if (!res.ok) throw new Error("save failed");
        /* A full reload, not a router.refresh(): the flag is seeded into
           TenantProvider by the dashboard layout at render time, and every
           gated surface reads it from there. Refreshing only the route segment
           would leave the provider holding the old value. */
        toast.success(next ? "EMV is shown again" : "EMV removed from the workspace");
        window.location.reload();
      } catch {
        setShowEmv(previous);
        toast.error("Could not save that. Nothing changed.");
      } finally {
        setSaving(false);
      }
    },
    [showEmv],
  );

  if (error) {
    return (
      <Card variant="outlined">
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
          Could not load metric settings. Reload the page to try again.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          cursor: showEmv === null || saving ? "default" : "pointer",
          opacity: showEmv === null ? 0.6 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={showEmv ?? true}
          disabled={showEmv === null || saving}
          onChange={(e) => save(e.target.checked)}
          style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--cc-primary)", cursor: "inherit" }}
        />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
            Show EMV (earned media value)
          </span>
          <span style={{ display: "block", fontSize: 13, color: "var(--cc-text-muted)", marginTop: 4, maxWidth: "62ch" }}>
            EMV is a modelled figure, not a measured one — views multiplied by a per-platform
            rate we choose. Turn it off and it disappears from the posts table and its CSV
            export, the campaign and post pages, both analytics tables, and every public
            report link, including ones you have already shared.
          </span>
        </span>
      </label>
    </Card>
  );
}
