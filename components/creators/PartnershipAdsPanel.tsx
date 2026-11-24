"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { Button, SectionCard, useConfirm } from "@/components/ds";
import { StatusPill, type Tone } from "@/components/portal/app/ui";
import { MetricHint } from "@/components/ds/MetricHint";

type Permission = { id: string; creatorUsername: string; creatorId: string | null; status: "APPROVED" | "PENDING" | "REVOKED" | "REJECTED" | "EXPIRED" | "UNKNOWN" };
type View = {
  brand: { username: string };
  creator: { username: string; hasInstagramId: boolean };
  permission: Permission | null;
  readable: boolean;
};
type State = { status: "loading" } | { status: "read"; view: View } | { status: "failed"; error: string | null; reason: string };
type Action = "request" | "revoke";

const STATUS: Record<Permission["status"], { tone: Tone; text: string }> = {
  APPROVED: { tone: "success", text: "Approved" },
  PENDING: { tone: "warning", text: "Waiting for the creator" },
  REVOKED: { tone: "neutral", text: "Withdrawn" },
  REJECTED: { tone: "danger", text: "Declined" },
  EXPIRED: { tone: "neutral", text: "Expired" },
  UNKNOWN: { tone: "neutral", text: "Unknown" },
};

const muted = { fontSize: 13, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.45 } as const;

/** Partnership Ads with this creator, using the workspace's own Instagram
    account as the brand: one permission, one action. Hidden where the feature
    is off or the creator has no Instagram. */
export default function PartnershipAdsPanel({ creatorId }: { creatorId: string }) {
  const confirm = useConfirm();
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
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

  const act = async (action: Action) => {
    if (action === "revoke") {
      const ok = await confirm({
        title: "Withdraw partnership ad permission?",
        description: "Your brand will no longer be able to run this creator's content as partnership ads. Ads already running are not stopped by this.",
        confirmLabel: "Withdraw",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) return toast.error(body?.reason ?? "Instagram did not accept that. Try again.");
      setState({ status: "read", view: body });
      toast.success(action === "request" ? "Request sent. The creator approves it in Instagram." : "Permission withdrawn");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") return null;
  if (state.status === "failed" && (state.error === "not_enabled" || state.error === "no_instagram")) return null;

  const view = state.status === "read" ? state.view : null;
  const p = view?.permission ?? null;
  const canAsk = !p || p.status === "REVOKED" || p.status === "REJECTED" || p.status === "EXPIRED";
  const action = view ? (
    canAsk ? (
      <Button size="sm" loading={busy} onClick={() => act("request")}>
        {p ? "Ask again" : "Request"}
      </Button>
    ) : (
      <Button size="sm" variant="ghost" loading={busy} onClick={() => act("revoke")}>
        Withdraw
      </Button>
    )
  ) : null;

  return (
    <div style={{ marginTop: 16 }}>
      <SectionCard icon={Megaphone} title="Partnership ads" action={action}>
        {view ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {p ? <StatusPill tone={STATUS[p.status].tone}>{STATUS[p.status].text}</StatusPill> : <span style={muted}>Not requested</span>}
            <MetricHint
              label="Partnership ads"
              what={`Lets @${view.brand.username} run @${view.creator.username}’s posts as ads. The creator approves it in Instagram.`}
            />
            {!view.readable && <span style={muted}>Instagram did not say where this stands.</span>}
          </div>
        ) : state.status === "failed" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <p role="alert" style={{ ...muted, color: "var(--cc-text)" }}>{state.reason}</p>
            {state.error === "no_brand_account" ? (
              <Link href="/settings/integrations" style={{ color: "var(--cc-primary)", fontWeight: 600, fontSize: 13 }}>Connect in Settings</Link>
            ) : (
              <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
            )}
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
