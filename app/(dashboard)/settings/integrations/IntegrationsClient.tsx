"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, Skeleton, Toggle } from "@pratham7711/ui";
import { Button, useConfirm } from "@/components/ds";
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
    fontSize: 14,
    border: "1px solid var(--cc-border)",
    borderRadius: 8,
    background: "var(--cc-card)",
    color: "var(--cc-text)",
  };

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <Card variant="outlined">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 24 }} aria-hidden>💬</div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Slack</h2>
            <p style={{ fontSize: 12.5, color: "var(--cc-text-muted)" }}>
              {view.connected
                ? `Connected${view.channel ? ` to ${view.channel}` : ""} · ${view.webhookMask}`
                : "Team notifications posted to a channel via an incoming webhook."}
            </p>
          </div>
        </div>

        {!view.connected && (
          <p style={{ fontSize: 12.5, color: "var(--cc-text-muted)", marginBottom: 12 }}>
            In Slack: your workspace → Tools & settings → Manage apps → Incoming Webhooks → Add to
            Slack, pick a channel, and paste the URL it gives you here.
          </p>
        )}

        <div style={{ display: "grid", gap: 10 }}>
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
              {view.connected ? "Save" : "Connect"}
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
      </Card>

      {view.connected && (
        <Card variant="outlined">
          <button
            onClick={() => setShowEvents((s) => !s)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 700,
              color: "var(--cc-text)",
            }}
          >
            Events posted to Slack {showEvents ? "▾" : "▸"}
          </button>
          <p style={{ fontSize: 12.5, color: "var(--cc-text-muted)", marginTop: 4 }}>
            Org-wide — applies to the channel, not to anyone&apos;s email.
          </p>
          {showEvents && (
            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              {groups.map(([group, defs]) => (
                <div key={group}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
                    {group}
                  </div>
                  <div style={{ display: "grid", gap: 2 }}>
                    {defs.map((def) => (
                      <div
                        key={def.key}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "6px 0" }}
                      >
                        <div style={{ fontSize: 13.5, color: "var(--cc-text)" }}>
                          {def.glyph} {def.label}
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
        </Card>
      )}
    </div>
  );
}
