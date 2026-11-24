"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Heart, Reply, Trash2 } from "lucide-react";
import type { IgComment } from "@/lib/platforms/instagramComments";
import { Button, Switch, useConfirm } from "@/components/ds";
import { Modal } from "@/components/ds/Modal";
import { SkeletonBlock, StatusPill, formatCount, relativeDay, secondaryButtonStyle } from "@/components/portal/app/ui";
import { Toggle, muted } from "@/components/insights/parts";

async function post(url: string, body: unknown): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true } : { ok: false, reason: data?.reason ?? "Instagram did not accept that. Try again." };
  } catch {
    return { ok: false, reason: "Network error. Try again." };
  }
}

const iconButton = { ...secondaryButtonStyle, minHeight: 28, padding: "3px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 } as const;

/* ---------- Comments (instagram_manage_comments) ---------- */

function CommentItem({ c, account, onChanged, isReply = false }: { c: IgComment; account: string; onChanged: () => void; isReply?: boolean }) {
  const confirm = useConfirm();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fieldId = useId();

  const act = async (action: "hide" | "unhide" | "delete" | "reply") => {
    if (action === "delete") {
      const ok = await confirm({
        title: "Delete this comment?",
        description: "It is removed from your post on Instagram for everyone. This can't be undone.",
        confirmLabel: "Delete comment",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(action);
    const r = await post("/api/portal/instagram/comments", action === "reply" ? { action, account, comment: c.id, message: text } : { action, account, comment: c.id });
    setBusy(null);
    if (!r.ok) return toast.error(r.reason);
    toast.success(action === "reply" ? "Reply posted" : action === "delete" ? "Comment deleted" : action === "hide" ? "Comment hidden" : "Comment visible again");
    if (action === "reply") {
      setText("");
      setReplying(false);
    }
    onChanged();
  };

  return (
    <li style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, opacity: c.hidden ? 0.72 : 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>@{c.username ?? "instagram user"}</span>
        {c.hidden && <StatusPill tone="neutral">Hidden</StatusPill>}
        {c.createdAt && <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{relativeDay(c.createdAt)}</span>}
        {typeof c.likes === "number" && c.likes > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>
            <Heart size={12} aria-hidden="true" /> {formatCount(c.likes)}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14, color: "var(--cc-text)", margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.text || "(no text)"}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
        {!isReply && (
          <button type="button" className="rsp-touch" style={iconButton} aria-expanded={replying} onClick={() => setReplying((v) => !v)}>
            <Reply size={12} aria-hidden="true" /> Reply
          </button>
        )}
        <button type="button" className="rsp-touch" style={iconButton} disabled={busy !== null} onClick={() => act(c.hidden ? "unhide" : "hide")}>
          {c.hidden ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
          {busy === "hide" || busy === "unhide" ? "Saving…" : c.hidden ? "Unhide" : "Hide"}
        </button>
        <button type="button" className="rsp-touch" style={{ ...iconButton, color: "var(--cc-danger)" }} disabled={busy !== null} onClick={() => act("delete")}>
          <Trash2 size={12} aria-hidden="true" /> {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {replying && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) act("reply");
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}
        >
          <label htmlFor={fieldId} className="sr-only">Reply to @{c.username ?? "instagram user"}</label>
          <textarea
            id={fieldId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={2200}
            placeholder={`Reply to @${c.username ?? "instagram user"}`}
            autoFocus
            style={{ width: "100%", resize: "vertical", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text)", fontSize: 14, fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Button size="sm" type="submit" loading={busy === "reply"} disabled={!text.trim()}>Post reply</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setReplying(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {c.replies.length > 0 && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: "0 0 0 14px", borderLeft: "1px solid var(--cc-border)", display: "flex", flexDirection: "column", gap: 12 }}>
          {c.replies.map((r) => (
            <CommentItem key={r.id} c={r} account={account} onChanged={onChanged} isReply />
          ))}
        </ul>
      )}
    </li>
  );
}

function Comments({ account, media }: { account: string; media: string }) {
  const [state, setState] = useState<IgComment[] | "loading" | { reason: string }>("loading");
  const read = useCallback(async () => {
    const res = await fetch(`/api/portal/instagram/comments?account=${encodeURIComponent(account)}&media=${encodeURIComponent(media)}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    return res?.ok && body ? body.comments : { reason: body?.reason ?? "Instagram did not return the comments. Try again." };
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

  if (state === "loading") return <SkeletonBlock height={160} />;
  if (!Array.isArray(state))
    return (
      <div>
        <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: "0 0 10px" }}>{state.reason}</p>
        <Button size="sm" variant="secondary" onClick={() => { setState("loading"); load(); }}>Try again</Button>
      </div>
    );
  if (state.length === 0) return <p style={muted}>Nobody has commented on this post yet.</p>;
  return (
    <div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 18 }}>
        {state.map((c) => (
          <CommentItem key={c.id} c={c} account={account} onChanged={load} />
        ))}
      </ul>
      <p style={{ ...muted, fontSize: 12, marginTop: 14 }}>Read live from Instagram, not saved. Changes happen on Instagram as soon as you click.</p>
    </div>
  );
}

/* ---------- Partnership ads (instagram_branded_content_creator) ---------- */

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

type Tab = "comments" | "ads";
const TABS: Array<{ value: Tab; label: string }> = [
  { value: "comments", label: "Comments" },
  { value: "ads", label: "Partnership ads" },
];

/** The Manage button on an Instagram post tile, and its dialog. */
export default function InstagramManage({ account, media, caption }: { account: string; media: string; caption: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("comments");
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="rsp-touch" onClick={() => setOpen(true)} style={{ ...secondaryButtonStyle, minHeight: 30, padding: "5px 12px", fontSize: 13 }}>
        Comments &amp; ads
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={caption.length > 60 ? `${caption.slice(0, 60)}…` : caption} size="lg" align="start">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Toggle label="Manage this post" options={TABS} value={tab} onChange={setTab} />
          {open && tab === "comments" && <Comments account={account} media={media} />}
          {open && tab === "ads" && <PartnerAds account={account} media={media} />}
        </div>
      </Modal>
    </div>
  );
}
