"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, Skeleton, Toggle } from "@pratham7711/ui";
import { apiFetch } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";

type EventDef = {
  key: string;
  label: string;
  description: string;
  group: string;
  defaultOn: boolean;
  glyph: string;
};

type Payload = { prefs: Record<string, boolean>; catalog: EventDef[] };

/**
 * One toggle per event, saved the moment it is flipped — the reference saves
 * per-switch too, and a Save button under thirty switches invites losing work.
 * The flip is optimistic; a failed PATCH flips it back and says so.
 */
export function NotificationSettingsClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Payload>("/api/settings/notifications")
      .then(setData)
      .catch((e) => toast.error(errorMessage(e, "Could not load notification settings")))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const byGroup = new Map<string, EventDef[]>();
    for (const def of data.catalog) {
      const list = byGroup.get(def.group) ?? [];
      list.push(def);
      byGroup.set(def.group, list);
    }
    return [...byGroup.entries()];
  }, [data]);

  async function flip(key: string, next: boolean) {
    if (!data) return;
    const prev = data.prefs;
    setData({ ...data, prefs: { ...prev, [key]: next } });
    try {
      const saved = await apiFetch<Payload>("/api/settings/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      setData(saved);
    } catch (e) {
      setData((d) => (d ? { ...d, prefs: prev } : d));
      toast.error(errorMessage(e, "Could not save"));
    }
  }

  if (loading) {
    return (
      <Card variant="outlined">
        <Skeleton width={200} height={18} />
        <div style={{ marginTop: 12 }}><Skeleton width="100%" height={120} /></div>
      </Card>
    );
  }
  if (!data) return null;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      {groups.map(([group, defs]) => (
        <Card key={group} variant="outlined">
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 14 }}>
            {group}
          </h2>
          <div style={{ display: "grid", gap: 4 }}>
            {defs.map((def) => (
              <div
                key={def.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--cc-border, rgba(128,128,128,.12))",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                    {def.glyph} {def.label}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--cc-text-muted)" }}>{def.description}</div>
                </div>
                <Toggle
                  checked={data.prefs[def.key] ?? def.defaultOn}
                  onChange={(next: boolean) => flip(def.key, next)}
                  size="md"
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
      {/* Says what these switches do and, just as importantly, what they do
          not. They used to be described as email preferences while no sender
          read them: activity email was removed on purpose (one campaign
          created mailed the whole org), and nothing has replaced it. What they
          genuinely control now is the bell in the top bar. */}
      <p style={{ fontSize: 12.5, color: "var(--cc-text-muted)" }}>
        These switches control the notification bell in the top bar. Activity email is
        not sent for these events — only sign-up, password reset and invites go out by
        email. Slack delivery is separate and org-wide: an admin sets it up once for the
        whole team under Settings → Integrations.
      </p>
    </div>
  );
}
