"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Heart, Pin } from "lucide-react";
import type { AdAuthorization, TikTokBusinessComment, TikTokBusinessPost } from "@/lib/platforms/tiktokBusiness";
import { AD_AUTH_DAYS } from "@/lib/platforms/tiktokBusiness";
import { Button, useConfirm } from "@/components/ds";
import { MetricHint } from "@/components/ds/MetricHint";
import { CopyField } from "@/components/ds/Modal";
import { FigureStrip, RankBars, SplitBar, Toggle, muted, formatPercent, type Figure } from "@/components/insights/parts";
import { SkeletonBlock, StatusPill, formatCount, formatDay, relativeDay, type Tone } from "@/components/portal/app/ui";
import { countryName, genderSegments, seconds } from "./format";

type Tab = "insights" | "comments" | "ad";
const TABS: Array<{ value: Tab; label: string }> = [
  { value: "insights", label: "Insights" },
  { value: "comments", label: "Comments" },
  { value: "ad", label: "Ad code" },
];

const label = (t: string) => <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>{t}</p>;

/* ---------- Insights (video.insights) ---------- */

function RetentionCurve({ points, duration }: { points: TikTokBusinessPost["retention"]; duration: number | null }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 96;
  const last = Math.max(duration ?? 0, points[points.length - 1].second, 1);
  const xy = points.map((p) => [(p.second / last) * w, h - Math.min(1, p.share) * h] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const half = points.find((p) => p.share <= 0.5);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Share of viewers still watching, by second" preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        <path d={`${line} L${xy[xy.length - 1][0].toFixed(1)} ${h} L${xy[0][0].toFixed(1)} ${h} Z`} style={{ fill: "var(--cc-primary)", fillOpacity: 0.1 }} />
        <path d={line} style={{ fill: "none", stroke: "var(--cc-primary)", strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption style={{ ...muted, fontSize: 12, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span>0s</span>
        <span>{half ? `Half of viewers still watching at ${seconds(half.second)}` : "Most viewers watch to the end"}</span>
        <span>{seconds(last)}</span>
      </figcaption>
    </figure>
  );
}

function Insights({ post }: { post: TikTokBusinessPost }) {
  const figures: Figure[] = [
    { label: "Views", value: post.views },
    { label: "Reach", value: post.reach, note: "People who watched at least once" },
    { label: "Average watch", value: null, display: post.averageWatchSeconds === null ? undefined : seconds(post.averageWatchSeconds), note: post.durationSeconds ? `of ${seconds(post.durationSeconds)}` : undefined },
    { label: "Watched in full", value: null, display: post.fullWatchRate === null ? undefined : formatPercent(post.fullWatchRate) },
    { label: "New followers", value: post.newFollowers },
    { label: "Total watch time", value: null, display: post.totalWatchSeconds === null ? undefined : seconds(post.totalWatchSeconds) },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <FigureStrip figures={figures} missing={(labels) => `TikTok did not return ${labels.join(", ").toLowerCase()} for this post.`} />
      {post.retention.length > 1 && (
        <div>
          {label("Who kept watching")}
          <RetentionCurve points={post.retention} duration={post.durationSeconds} />
        </div>
      )}
      {post.sources.length > 0 && (
        <div>
          {label("Where views came from")}
          <RankBars rows={post.sources.slice(0, 6).map((s) => ({ key: s.key, label: s.key, share: s.share }))} />
        </div>
      )}
      {(post.audience.genders.length > 0 || post.audience.countries.length > 0) && (
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
          {post.audience.genders.length > 0 && (
            <div>
              {label("Viewers by gender")}
              <SplitBar label="Viewers by gender" segments={genderSegments(post.audience.genders)} />
            </div>
          )}
          {post.audience.countries.length > 0 && (
            <div>
              {label("Top countries")}
              <RankBars rows={post.audience.countries.slice(0, 4).map((c) => ({ key: c.key, label: countryName(c.key), share: c.share }))} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Comments (comment.list) ---------- */

function CommentRow({ c, videoId }: { c: TikTokBusinessComment; videoId: string }) {
  const [replies, setReplies] = useState<TikTokBusinessComment[] | "loading" | "failed" | null>(null);
  const toggle = async () => {
    if (replies && replies !== "failed") return setReplies(null);
    setReplies("loading");
    const res = await fetch(`/api/portal/tiktok-business/comments?video=${encodeURIComponent(videoId)}&comment=${encodeURIComponent(c.id)}`, { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    setReplies(body?.comments ?? "failed");
  };
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>@{c.username ?? "tiktok user"}</span>
        {c.byOwner && <StatusPill tone="info">You</StatusPill>}
        {c.pinned && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: "var(--cc-text-muted)" }}>
            <Pin size={12} aria-hidden="true" /> Pinned
          </span>
        )}
        {c.createdAt && <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{relativeDay(c.createdAt)}</span>}
      </div>
      <p style={{ fontSize: 14, color: "var(--cc-text)", margin: 0, lineHeight: 1.5, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{c.text || "(no text)"}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--cc-text-muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontVariantNumeric: "tabular-nums" }}>
          <Heart size={12} aria-hidden="true" /> {formatCount(c.likes)}
        </span>
        {c.replies > 0 && (
          <button type="button" onClick={toggle} aria-expanded={Array.isArray(replies)} className="rsp-touch" style={{ display: "inline-flex", alignItems: "center", gap: 3, border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--cc-primary)" }}>
            {Array.isArray(replies) ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
            {replies === "loading" ? "Reading replies…" : `${c.replies} ${c.replies === 1 ? "reply" : "replies"}`}
          </button>
        )}
      </div>
      {replies === "failed" && <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: 0 }}>TikTok did not return the replies. Try again.</p>}
      {Array.isArray(replies) && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: "0 0 0 14px", borderLeft: "1px solid var(--cc-border)", display: "flex", flexDirection: "column", gap: 10 }}>
          {replies.map((r) => (
            <li key={r.id} style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>@{r.username ?? "tiktok user"}</span>
              {r.byOwner && <> <StatusPill tone="info">You</StatusPill></>}
              <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "2px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" }}>{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Comments({ post }: { post: TikTokBusinessPost }) {
  const [state, setState] = useState<TikTokBusinessComment[] | "loading" | { reason: string }>("loading");
  const read = useCallback(async () => {
    const res = await fetch(`/api/portal/tiktok-business/comments?video=${encodeURIComponent(post.id)}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    return res?.ok && body ? body.comments : { reason: body?.reason ?? "TikTok did not return the comments. Try again." };
  }, [post.id]);
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

  if (state === "loading") return <SkeletonBlock height={180} />;
  if (!Array.isArray(state))
    return (
      <div>
        <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: "0 0 10px" }}>{state.reason}</p>
        <Button variant="secondary" size="sm" onClick={() => { setState("loading"); load(); }}>Try again</Button>
      </div>
    );
  if (state.length === 0) return <p style={muted}>No comments on this post yet.</p>;
  return (
    <div>
      <p style={{ ...muted, fontSize: 12, marginBottom: 12 }}>Most liked first</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {state.map((c) => (
          <CommentRow key={c.id} c={c} videoId={post.id} />
        ))}
      </ul>
    </div>
  );
}

/* ---------- Ad code (biz.spark.auth) ---------- */

const STATUS: Record<string, { tone: Tone; text: string }> = {
  NOT_USED: { tone: "info", text: "Ready to use" },
  IN_USE: { tone: "success", text: "In use by an ad" },
  EXPIRED: { tone: "neutral", text: "Expired" },
  UNKNOWN: { tone: "neutral", text: "Active" },
};

const DAY_OPTIONS = AD_AUTH_DAYS.map((d) => ({ value: String(d) as `${number}`, label: d === 365 ? "1 year" : `${d} days` }));

function AdCode({ post }: { post: TikTokBusinessPost }) {
  const confirm = useConfirm();
  const id = useId();
  const [auth, setAuth] = useState<AdAuthorization | "loading" | { reason: string }>("loading");
  const [days, setDays] = useState<`${number}`>("30");
  const [busy, setBusy] = useState<string | null>(null);

  const read = useCallback(async () => {
    const res = await fetch(`/api/portal/tiktok-business/ad-code?item=${encodeURIComponent(post.id)}`, { cache: "no-store" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    return res?.ok && body ? body.authorization : { reason: body?.reason ?? "TikTok did not return this post's ad authorization." };
  }, [post.id]);
  useEffect(() => {
    let live = true;
    read().then((v) => {
      if (live) setAuth(v);
    });
    return () => {
      live = false;
    };
  }, [read]);
  const load = () => read().then(setAuth);

  const act = async (action: "enable" | "extend" | "delete") => {
    if (action === "delete") {
      const ok = await confirm({
        title: "Delete this ad code?",
        description: "Ads already running from it keep running until they end, but nobody can start a new ad with this code. You can create a new one any time.",
        confirmLabel: "Delete code",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await fetch("/api/portal/tiktok-business/ad-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "delete" ? { action, item: post.id } : { action, item: post.id, days: Number(days) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return toast.error(body?.reason ?? "TikTok did not accept that. Try again.");
      setAuth(body.authorization);
      toast.success(action === "enable" ? "Ad code created" : action === "extend" ? "Ad code extended" : "Ad code deleted");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (auth === "loading") return <SkeletonBlock height={140} />;
  if ("reason" in auth)
    return (
      <div>
        <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: "0 0 10px" }}>{auth.reason}</p>
        <Button variant="secondary" size="sm" onClick={() => { setAuth("loading"); load(); }}>Try again</Button>
      </div>
    );

  const periodPicker = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span id={id} style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{auth.enabled ? "Extend by" : "Valid for"}</span>
      <Toggle label={auth.enabled ? "Extend by" : "Valid for"} options={DAY_OPTIONS} value={days} onChange={setDays} />
    </div>
  );

  if (!auth.enabled)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
        <p style={{ fontSize: 14, color: "var(--cc-text)", margin: 0, lineHeight: 1.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Ad authorization is off for this post.
          <MetricHint label="Ad code" what="Turn it on to get a code you can give a brand, so they can run this post as a Spark Ad from your account." />
        </p>
        {periodPicker}
        <Button loading={busy === "enable"} onClick={() => act("enable")}>Turn on and create code</Button>
      </div>
    );

  const status = STATUS[auth.status] ?? STATUS.UNKNOWN;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
        {auth.endsAt && <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{auth.status === "EXPIRED" ? "Expired" : "Valid until"} {formatDay(auth.endsAt, { utc: true })}</span>}
      </div>
      <CopyField value={auth.code} label="Copy code" onCopied={() => toast.success("Code copied")} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        {periodPicker}
        <Button variant="secondary" loading={busy === "extend"} onClick={() => act("extend")}>Extend</Button>
        <Button variant="ghost" loading={busy === "delete"} onClick={() => act("delete")}>Delete code</Button>
      </div>
    </div>
  );
}

/** One post's detail: its insights, its comments and its ad code. */
export default function PostDetail({ post }: { post: TikTokBusinessPost }) {
  const [tab, setTab] = useState<Tab>("insights");
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 240px" }}>
          <h3 id={headingId} style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0, lineHeight: 1.4, overflowWrap: "anywhere" }}>
            {post.caption || "Untitled post"}
          </h3>
          <p style={{ ...muted, fontSize: 12, marginTop: 2 }}>
            {post.postedAt ? `Posted ${formatDay(post.postedAt)}` : "Post"}
            {post.isAd && " · running as an ad"}
            {post.shareUrl && (
              <>
                {" · "}
                <a href={post.shareUrl} target="_blank" rel="noreferrer" style={{ color: "var(--cc-primary)" }}>Open on TikTok</a>
              </>
            )}
          </p>
        </div>
        <Toggle label="Post detail" options={TABS} value={tab} onChange={setTab} />
      </div>
      {tab === "insights" && <Insights post={post} />}
      {tab === "comments" && <Comments post={post} />}
      {tab === "ad" && <AdCode post={post} />}
    </section>
  );
}
