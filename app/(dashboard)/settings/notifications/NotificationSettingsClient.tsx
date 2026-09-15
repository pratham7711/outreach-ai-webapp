"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Card, Skeleton, Toggle } from "@pratham7711/ui";
import { SectionCard } from "@/components/ds";
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
    <div className="cc-settings-groups">
      {groups.map(([group, defs]) => (
        <SectionCard
          key={group}
          icon={Bell}
          title={group}
          description={`Customize settings for ${group}`}
        >
          <div className="cc-pref-rows">
            {defs.map((def) => (
              <div key={def.key} className="cc-pref-row">
                <div className="cc-pref-row-text">
                  <div className="cc-pref-row-title">{def.label}</div>
                  <div className="cc-pref-row-desc">{def.description}</div>
                </div>
                <Toggle
                  checked={data.prefs[def.key] ?? def.defaultOn}
                  onChange={(next: boolean) => flip(def.key, next)}
                  size="md"
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
        These switches control the notification bell in the top bar. Activity email is
        not sent for these events — only sign-up, password reset and invites go out by
        email. Slack delivery is separate and org-wide: an admin sets it up once for the
        whole team under Settings → Integrations.
      </p>
    </div>
  );
}
