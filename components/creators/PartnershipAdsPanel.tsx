"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { Button, SectionCard, Switch, useConfirm } from "@/components/ds";
import { StatusPill, type Tone } from "@/components/portal/app/ui";
import { MetricHint } from "@/components/ds/MetricHint";

type Permission = { id: string; creatorUsername: string; creatorId: string | null; status: "APPROVED" | "PENDING" | "REVOKED" | "REJECTED" | "EXPIRED" | "UNKNOWN" };
type View = {
  brand: { username: string };
  creator: { username: string; hasInstagramId: boolean };
  permission: Permission | null;
  readable: boolean;
  tagApproved: boolean | null;
};
type State = { status: "loading" } | { status: "read"; view: View } | { status: "failed"; error: string | null; reason: string };

const STATUS: Record<Permission["status"], { tone: Tone; text: string }> = {
  APPROVED: { tone: "success", text: "Approved" },
  PENDING: { tone: "warning", text: "Waiting for the creator" },
  REVOKED: { tone: "neutral", text: "Withdrawn" },
  REJECTED: { tone: "danger", text: "Declined" },
  EXPIRED: { tone: "neutral", text: "Expired" },
  UNKNOWN: { tone: "neutral", text: "Unknown" },
};

const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" } as const;
const small = { fontSize: 13, color: "var(--cc-text-muted)", margin: "2px 0 0", lineHeight: 1.45 } as const;

/** Partnership Ads with this creator, using the workspace's own Instagram
    account as the brand: ask for account-level permission to run their
    content as ads (they approve in Instagram), see where it stands, withdraw
    it, and keep them on the brand's approved-to-tag list. Hidden where the
    feature is off. */
export default function PartnershipAdsPanel({ creatorId }: { creatorId: string }) {
  const confirm = useConfirm();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const url = `/api/creators/${encodeURIComponent(creatorId)}/partnership-ads`;

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (res?.ok && body) setState({ status: "read", view: body });
    else setState({ status: "failed", error: body?.error ?? null, reason: body?.reason ?? "We couldn't read partnership ads for this creator." });
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: "request" | "revoke" | "approve_tag" | "remove_tag") => {
    if (action === "revoke") {
      const ok = await confirm({
        title: "Withdraw partnership ad permission?",
        description: "Your brand will no longer be able to run this creator's content as partnership ads. Ads already running are not stopped by this.",
        confirmLabel: "Withdraw",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) return toast.error(body?.reason ?? "Instagram did not accept that. Try again.");
      setState({ status: "read", view: body });
      toast.success(
        action === "request" ? "Request sent. The creator approves it in Instagram." : action === "revoke" ? "Permission withdrawn" : action === "approve_tag" ? "Added to approved creators" : "Removed from approved creators",
      );
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (state.status === "loading") return null;
  if (state.status === "failed" && (state.error === "not_enabled" || state.error === "no_instagram")) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <SectionCard icon={Megaphone} title="Partnership ads">
        {state.status === "failed" ? (
          <div>
            <p role="alert" style={{ fontSize: 14, color: "var(--cc-text)", margin: 0 }}>{state.reason}</p>
            {state.error === "no_brand_account" ? (
              <p style={{ ...small, marginTop: 8 }}>
                <Link href="/settings/integrations" style={{ color: "var(--cc-primary)", fontWeight: 600 }}>Open Settings → Integrations</Link>
              </p>
            ) : (
              <Button size="sm" variant="secondary" onClick={load} style={{ marginTop: 10 }}>Try again</Button>
            )}
          </div>
        ) : (
          <PanelBody view={state.view} busy={busy} act={act} />
        )}
      </SectionCard>
    </div>
  );
}

function PanelBody({ view, busy, act }: { view: View; busy: string | null; act: (a: "request" | "revoke" | "approve_tag" | "remove_tag") => void }) {
  const p = view.permission;
  const status = p ? STATUS[p.status] : null;
  const canAsk = !p || p.status === "REVOKED" || p.status === "REJECTED" || p.status === "EXPIRED";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={row}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>Ad permission</span>
            <MetricHint label="Ad permission" what={`Lets @${view.brand.username} run @${view.creator.username}\u2019s posts as partnership ads.`} />
            {status && <StatusPill tone={status.tone}>{status.text}</StatusPill>}
          </div>
          {!view.readable && <p style={small}>Instagram did not say where this stands.</p>}
        </div>
        {canAsk ? (
          <Button size="sm" loading={busy === "request"} onClick={() => act("request")}>
            {p ? "Ask again" : "Request permission"}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" loading={busy === "revoke"} onClick={() => act("revoke")}>
            Withdraw
          </Button>
        )}
      </div>
      <div style={{ ...row, borderTop: "1px solid var(--cc-border)", paddingTop: 16 }}>
        <div id={`tag-approved-${view.creator.username}`} style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>Approved to tag @{view.brand.username}</span>
            <MetricHint label="Approved to tag" what="Approved creators can tag your brand as a paid partner without asking each time." />
          </div>
          {!view.creator.hasInstagramId && <p style={small}>Available once the creator connects Instagram.</p>}
        </div>
        <Switch
          checked={view.tagApproved === true}
          disabled={!view.creator.hasInstagramId || busy === "approve_tag" || busy === "remove_tag"}
          onChange={(next) => act(next ? "approve_tag" : "remove_tag")}
          aria-labelledby={`tag-approved-${view.creator.username}`}
        />
      </div>
    </div>
  );
}
