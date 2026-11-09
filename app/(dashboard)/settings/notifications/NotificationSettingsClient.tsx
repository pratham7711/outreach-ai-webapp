"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import Link from "next/link";
import { LoadError, SectionCard, Skeleton } from "@/components/ds";
import { MetricHint } from "@/components/ds/MetricHint";
import { Switch } from "@/components/ds/Switch";
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
 *
 * Each group is a SectionCard, which is what puts the group name and its line
 * of description in the 280px left column and the switches in the right one.
 * MEASURED 2026-09-14 at desktop-1600: theirs is `Campaigns` 323,135 18/400
 * over `Customize settings for campaigns` 323,166.5 12/400, with the rows from
 * 603 out to 1552 — ours was an 18/700 h2 at 316,128 above full-width rows in a
 * 760px card.
 */
export function NotificationSettingsClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    apiFetch<Payload>("/api/settings/notifications")
      .then(setData)
      .catch((e) => toast.error(errorMessage(e, "Could not load notification settings")))
      .finally(() => setLoading(false));
  }, [loadKey]);

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
      <SectionCard icon={Bell} title="Notifications">
        <div className="cc-settings-skeleton" aria-busy="true" aria-label="Loading notification settings">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={40} />
          ))}
        </div>
      </SectionCard>
    );
  }
  /* A failed load was a blank space under the header. */
  if (!data) {
    return (
      <LoadError
        title="Notification settings could not be loaded"
        description="Nothing was changed. Your switches are as you left them."
        onRetry={() => (setLoading(true), setLoadKey((k) => k + 1))}
      />
    );
  }

  return (
    <div className="cc-settings-groups">
      {groups.map(([group, defs]) => (
        <SectionCard
          key={group}
          icon={Bell}
          title={group}
        >
          <div className="cc-pref-rows">
            {defs.map((def) => (
              <div key={def.key} className="cc-pref-row">
                <div className="cc-pref-row-text">
                  <div className="cc-pref-row-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span id={`notif-${def.key}`}>{def.label}</span>
                    {(def.description.match(/\S+/g) ?? []).length > 8 ? <MetricHint label={def.label} what={def.description} /> : null}
                  </div>
                </div>
                {/* Named by the row's own title, so each switch announces what
                    it controls; without a name all twelve read as "switch". */}
                <Switch
                  checked={data.prefs[def.key] ?? def.defaultOn}
                  onChange={(next) => flip(def.key, next)}
                  aria-labelledby={`notif-${def.key}`}
                />
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
      {/* Says what these switches do and, just as importantly, what they do
          not. They used to be described as email preferences while no sender
          read them: activity email was removed on purpose (one campaign
          created mailed the whole org), and nothing has replaced it. What they
          genuinely control now is the bell in the top bar. */}
      <p className="cc-settings-note">
        Bell only, no email. Slack is set up in <Link href="/settings/integrations">Integrations</Link>.
      </p>
    </div>
  );
}
