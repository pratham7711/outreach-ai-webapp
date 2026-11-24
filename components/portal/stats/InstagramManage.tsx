"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Switch } from "@/components/ds";
import { Modal } from "@/components/ds/Modal";
import { SkeletonBlock, secondaryButtonStyle } from "@/components/portal/app/ui";
import { muted } from "@/components/insights/parts";

async function post(url: string, body: unknown): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true } : { ok: false, reason: data?.reason ?? "Instagram did not accept that. Try again." };
  } catch {
    return { ok: false, reason: "Network error. Try again." };
  }
}

type Partner = { sponsorId: string; username: string; orgName: string; allowed: boolean };

function PartnerAds({ account, media }: { account: string; media: string }) {
  const [state, setState] = useState<{ partners: Partner[]; readable: boolean } | "loading" | { reason: string }>("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const read = useCallback(async () => {
    const res = await fetch(`/api/portal/instagram/partner-boost?account=${encodeURIComponent(account)}&media=${encodeURIComponent(media)}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    return res?.ok && body ? body : { reason: body?.reason ?? "Instagram did not return this post's partners. Try again." };
  }, [account, media]);
  useEffect(() => {
    let live = true;
    read().then((v) => {
      if (live) setState(v);
    });
    return () => {
      live = false;
    };
  }, [read]);
  const load = () => read().then(setState);

  const flip = async (p: Partner, allow: boolean) => {
    setBusy(p.sponsorId);
    const r = await post("/api/portal/instagram/partner-boost", { account, media, sponsorId: p.sponsorId, allow });
    setBusy(null);
    if (!r.ok) return toast.error(r.reason);
    toast.success(allow ? `@${p.username} can now boost this post` : `@${p.username} can no longer boost this post`);
    setState((s) => (typeof s === "object" && "partners" in s ? { ...s, partners: s.partners.map((x) => (x.sponsorId === p.sponsorId ? { ...x, allowed: allow } : x)) } : s));
  };

  if (state === "loading") return <SkeletonBlock height={120} />;
  if ("reason" in state)
    return (
      <div>
        <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: "0 0 10px" }}>{state.reason}</p>
        <Button size="sm" variant="secondary" onClick={() => { setState("loading"); load(); }}>Try again</Button>
      </div>
    );
  if (state.partners.length === 0)
    return <p style={muted}>None of the organisations you work with has connected a brand Instagram account yet.</p>;
  return (
    <div>
      <p style={{ fontSize: 14, color: "var(--cc-text)", margin: "0 0 14px", lineHeight: 1.5 }}>
        Let a brand you work with run this post as a partnership ad from their account.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {state.partners.map((p) => {
          const labelId = `boost-${p.sponsorId}`;
          return (
            <li key={p.sponsorId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--cc-border)" }}>
              <div id={labelId} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflowWrap: "anywhere" }}>@{p.username}</div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{p.orgName} · {p.allowed ? "Can boost this post" : "Can't boost this post"}</div>
              </div>
              <Switch checked={p.allowed} disabled={busy === p.sponsorId} onChange={(next) => flip(p, next)} aria-labelledby={labelId} />
            </li>
          );
        })}
      </ul>
      {!state.readable && <p style={{ ...muted, fontSize: 12, marginTop: 10 }}>Instagram did not say which brands are already allowed; the switches show off until you change one.</p>}
      <p style={{ ...muted, fontSize: 12, marginTop: 10 }}>The post must be tagged with the brand as a paid partnership.</p>
    </div>
  );
}

/** The Partnership ads button on an Instagram post tile, and its dialog. */
export default function InstagramManage({ account, media, caption }: { account: string; media: string; caption: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="rsp-touch" onClick={() => setOpen(true)} style={{ ...secondaryButtonStyle, minHeight: 30, padding: "5px 12px", fontSize: 13 }}>
        Partnership ads
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={caption.length > 60 ? `${caption.slice(0, 60)}…` : caption} size="lg" align="start">
        {open && <PartnerAds account={account} media={media} />}
      </Modal>
    </div>
  );
}
