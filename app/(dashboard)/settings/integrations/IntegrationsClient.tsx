"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, Skeleton, Toggle } from "@pratham7711/ui";
import { BellRing, Plug } from "lucide-react";
import { Button, SectionCard, useConfirm } from "@/components/ds";
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

type SlackView = {
  connected: boolean;
  webhookMask: string | null;
  channel: string | null;
  connectedAt: string | null;
  events: Record<string, boolean>;
  catalog: EventDef[];
};

/**
 * Slack via incoming webhook. The form asks for the one thing Slack's "Add an
 * incoming webhook" screen hands over, and the channel field is a label — the
 * webhook itself is bound to a channel when Slack mints it, and pretending we
 * control the destination would be a lie in UI form.
 */
export function IntegrationsClient() {
  const [view, setView] = useState<SlackView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channel, setChannel] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    apiFetch<SlackView>("/api/settings/integrations/slack")
      .then((v) => {
        setView(v);
        setChannel(v.channel ?? "");
      })
      .catch((e) => toast.error(errorMessage(e, "Could not load integrations")))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    if (!view) return [];
    const byGroup = new Map<string, EventDef[]>();
    for (const def of view.catalog) {
      const list = byGroup.get(def.group) ?? [];
      list.push(def);
      byGroup.set(def.group, list);
    }
    return [...byGroup.entries()];
  }, [view]);

  async function save(body: Record<string, unknown>, doneMsg: string) {
    setBusy(true);
    try {
      const next = await apiFetch<SlackView>("/api/settings/integrations/slack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setView(next);
      setWebhookUrl("");
      setChannel(next.channel ?? "");
      toast.success(doneMsg);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save"));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await apiFetch("/api/settings/integrations/slack", { method: "POST" });
      toast.success("Test message sent — check the channel");
    } catch (e) {
      toast.error(errorMessage(e, "Test failed"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect Slack?",
      description: "Notifications stop immediately. The webhook itself keeps working until you also remove it in Slack.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await apiFetch<SlackView>("/api/settings/integrations/slack", { method: "DELETE" });
      setView(next);
      setChannel("");
      toast.success("Slack disconnected");
    } catch (e) {
      toast.error(errorMessage(e, "Could not disconnect"));
    } finally {
      setBusy(false);
    }
  }


  if (loading) {
    return (
      <Card variant="outlined">
        <Skeleton width={200} height={18} />
        <div style={{ marginTop: 12 }}><Skeleton width="100%" height={100} /></div>
      </Card>
    );
  }
  if (!view) return null;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    fontSize: "var(--cc-t-14)",
    border: "1px solid var(--cc-border)",
    borderRadius: 8,
    background: "var(--cc-card)",
    color: "var(--cc-text)",
  };

  return (
    <div className="cc-settings-groups">
      <SectionCard
        icon={Plug}
        title="Integrations"
        description="Connect with Slack to receive updates and notifications directly in your selected channel."
      >
        {/* One row per connector, the reference's shape for this page. MEASURED
            2026-09-14 at desktop-1600: their card is 291,104 1293x142 with the
            logo at 628,161 28x28, `Slack` at 668,162.8 18/400 and a pill CTA at
            1417.7,153 109.3x44 r=70. Ours was a 760-wide card holding a 💬 at
            24px, an 18/700 name, two 710x41 inputs and a 91.6x38 button 200px
            further down — because the webhook is ours to paste and theirs to
            mint through OAuth. So the form is what the CTA opens, and the row
            at rest is the row they draw. */}
        <div className="cc-provider-row">
          <div className="cc-provider-id">
            <span className="cc-provider-logo" aria-hidden>💬</span>
            <div className="cc-pref-row-text">
              <span className="cc-provider-name">Slack</span>
              {view.connected ? (
                <span className="cc-pref-row-desc">
                  Connected{view.channel ? ` to ${view.channel}` : ""} · {view.webhookMask}
                </span>
              ) : null}
            </div>
          </div>
          <Button
            className="cc-provider-cta"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {view.connected ? "Manage" : "Connect"}
          </Button>
        </div>

        {open ? (
          <div style={{ display: "grid", gap: 10, paddingTop: 4 }}>
            {!view.connected && (
              <p className="cc-pref-row-desc">
                In Slack: your workspace → Tools &amp; settings → Manage apps → Incoming Webhooks → Add to
                Slack, pick a channel, and paste the URL it gives you here.
              </p>
            )}
            <input
              style={inputStyle}
              type="url"
              placeholder={view.connected ? "Paste a new webhook URL to replace the current one" : "https://hooks.slack.com/services/…"}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              disabled={busy}
            />
            <input
              style={inputStyle}
              type="text"
              placeholder="Channel label, e.g. #campaigns (display only)"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              disabled={busy}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                onClick={() =>
                  save(
                    webhookUrl.trim() ? { webhookUrl: webhookUrl.trim(), channel } : { channel },
                    view.connected ? "Saved" : "Slack connected"
                  )
                }
                disabled={busy || (!view.connected && !webhookUrl.trim())}
              >
                {view.connected ? "Save" : "Connect Slack"}
              </Button>
              {view.connected && (
                <>
                  <Button variant="secondary" onClick={test} disabled={busy}>
                    Send test message
                  </Button>
                  <Button variant="danger" onClick={disconnect} disabled={busy}>
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </SectionCard>

      {view.connected && (
        <SectionCard
          icon={BellRing}
          title="Events"
          description="Org-wide — these post to the channel, not to anyone's email."
        >
          <button
            onClick={() => setShowEvents((s) => !s)}
            className="cc-provider-name"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            Events posted to Slack {showEvents ? "▾" : "▸"}
          </button>
          {showEvents && (
            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              {groups.map(([group, defs]) => (
                <div key={group}>
                  <div className="cc-microlabel" style={{ marginBottom: 6 }}>
                    {group}
                  </div>
                  <div className="cc-pref-rows">
                    {defs.map((def) => (
                      <div key={def.key} className="cc-pref-row">
                        <div className="cc-pref-row-text">
                          <div className="cc-pref-row-title">{def.label}</div>
                        </div>
                        <Toggle
                          checked={view.events[def.key] ?? def.defaultOn}
                          onChange={(next: boolean) => {
                            setView((v) => (v ? { ...v, events: { ...v.events, [def.key]: next } } : v));
                            save({ events: { [def.key]: next } }, "Saved");
                          }}
                          size="sm"
                          disabled={busy}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
