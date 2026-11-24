"use client";

import { Suspense, useCallback, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Film, Play, Unplug } from "lucide-react";
import type { DailyMetrics, TikTokBusinessPost, TikTokBusinessProfile } from "@/lib/platforms/tiktokBusiness";
import type { TikTokBusinessSummary } from "@/lib/portal/tiktokBusinessConnection";
import { Button, useConfirm } from "@/components/ds";
import { Banner, EmptyState, Screen, SkeletonBlock, SourceLabel, formatCount, formatDay, type Tone } from "@/components/portal/app/ui";
import { ColumnBars, Donut, Panel, RankBars, SectionHeading, Thumb, Toggle, muted } from "@/components/insights/parts";
import type { DayValue } from "@/components/insights/charts";
import { MetricExplorer, type ExplorerMetric } from "@/components/insights/MetricExplorer";
import PostDetail from "@/components/portal/tiktokBusiness/PostDetail";
import { countryName, genderSegments } from "@/components/portal/tiktokBusiness/format";

type Days = "7" | "28" | "60";
const WINDOWS: Array<{ value: Days; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "28", label: "28 days" },
  { value: "60", label: "60 days" },
];

type Loaded = { connection: TikTokBusinessSummary; profile: TikTokBusinessProfile; readAt: string };
type State = { kind: "loading" } | { kind: "ready"; data: Loaded } | { kind: "refused"; error: string; reason: string } | { kind: "failed" };

const ACCOUNT_TYPE: Record<TikTokBusinessProfile["accountType"], { tone: Tone; text: string }> = {
  business: { tone: "success", text: "Business account" },
  advanced: { tone: "info", text: "Creator account · advanced analytics" },
  personal: { tone: "neutral", text: "Personal account" },
};

function series(daily: DailyMetrics[], pick: (d: DailyMetrics) => number | null): DayValue[] {
  return daily.flatMap((d) => {
    const v = pick(d);
    return v === null ? [] : [{ day: d.date, value: v }];
  });
}

const sum = (pts: DayValue[]) => (pts.length ? pts.reduce((a, p) => a + p.value, 0) : null);

function Header({ profile }: { profile: TikTokBusinessProfile }) {
  const type = ACCOUNT_TYPE[profile.accountType];
  const counts: Array<[string, number | null]> = [
    ["Following", profile.following],
    ["Followers", profile.followers],
    ["Likes", profile.totalLikes],
    ["Videos", profile.videos],
  ];
  return (
    <section
      aria-label="Your TikTok account"
      style={{
        background: "var(--cc-plat-band)",
        color: "var(--cc-plat-on-band)",
        borderRadius: "var(--cc-r-card)",
        padding: "28px 24px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 10,
      }}
    >
      <span style={{ padding: 3, borderRadius: "50%", background: "var(--cc-plat-ring)", display: "inline-flex" }}>
        <span style={{ padding: 3, borderRadius: "50%", background: "var(--cc-plat-band)", display: "inline-flex" }}>
          <Thumb src={profile.avatarUrl} width={84} height={84} radius={42} />
        </span>
      </span>
      <div>
        <h2 style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 20, fontWeight: 700, margin: 0, color: "inherit" }}>
          {profile.displayName || `@${profile.username}`}
          {profile.isVerified && <BadgeCheck size={18} aria-label="Verified" style={{ color: "var(--cc-tiktok-cyan)" }} />}
        </h2>
        <p style={{ fontSize: 14, margin: "2px 0 0", color: "var(--cc-plat-on-band-muted)" }}>
          {profile.profileUrl ? (
            <a href={profile.profileUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>@{profile.username}</a>
          ) : (
            `@${profile.username}`
          )}
          {" · "}
          {type.text}
        </p>
      </div>
      <dl style={{ display: "flex", justifyContent: "center", margin: "6px 0 0", flexWrap: "wrap", rowGap: 10 }}>
        {counts.map(([k, v], i) => (
          <div key={k} style={{ padding: "0 clamp(8px, 2.6vw, 22px)", borderLeft: i ? "1px solid color-mix(in srgb, var(--cc-plat-on-band) 18%, transparent)" : "none", display: "flex", flexDirection: "column-reverse" }}>
            <dt style={{ fontSize: 13, color: "var(--cc-plat-on-band-muted)" }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: "clamp(0.9375rem, 0.75rem + 1vw, 1.1875rem)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v === null ? "—" : formatCount(v)}</dd>
          </div>
        ))}
      </dl>
      {profile.bio?.trim() && <p style={{ fontSize: 14, margin: "4px 0 0", maxWidth: "52ch", lineHeight: 1.5, color: "var(--cc-plat-on-band)", whiteSpace: "pre-wrap" }}>{profile.bio.trim()}</p>}
    </section>
  );
}

function Analytics({ profile, days, onDays }: { profile: TikTokBusinessProfile; days: Days; onDays: (d: Days) => void }) {
  const views = series(profile.daily, (d) => d.videoViews);
  const profileViews = series(profile.daily, (d) => d.profileViews);
  const followers = series(profile.daily, (d) => d.followers);
  const gained = series(profile.daily, (d) => d.newFollowers);
  const lost = series(profile.daily, (d) => d.lostFollowers);
  const likes = series(profile.daily, (d) => d.likes);
  const shares = series(profile.daily, (d) => d.shares);
  const comments = series(profile.daily, (d) => d.comments);
  const net = sum(gained) !== null && sum(lost) !== null ? sum(gained)! - sum(lost)! : null;
  const latest = followers.length ? followers[followers.length - 1].value : null;
  const metrics: ExplorerMetric[] = [
    { key: "views", label: "Video views", value: sum(views), points: views, kind: "daily", describe: (v) => `${formatCount(v)} views` },
    { key: "profile", label: "Profile views", value: sum(profileViews), points: profileViews, kind: "daily", describe: (v) => `${formatCount(v)} profile views` },
    {
      key: "followers",
      label: "Followers",
      value: latest,
      note: net === null ? undefined : `${net >= 0 ? "+" : "−"}${formatCount(Math.abs(net))} this period`,
      points: followers,
      kind: "total",
      describe: (v) => `${formatCount(v)} followers`,
    },
    { key: "gained", label: "New followers", value: sum(gained), points: gained, kind: "daily", describe: (v) => `+${formatCount(v)} new followers` },
    { key: "likes", label: "Likes", value: sum(likes), points: likes, kind: "daily", describe: (v) => `${formatCount(v)} likes` },
    { key: "comments", label: "Comments", value: sum(comments), points: comments, kind: "daily", describe: (v) => `${formatCount(v)} comments` },
    { key: "shares", label: "Shares", value: sum(shares), points: shares, kind: "daily", describe: (v) => `${formatCount(v)} shares` },
  ];
  const id = useId();
  return (
    <Panel labelledBy={id}>
      <SectionHeading id={id} level={2} title="Account analytics" aside={<Toggle label="Period" options={WINDOWS} value={days} onChange={onDays} />} />
      {profile.daily.length === 0 ? (
        <p style={muted}>TikTok has no daily figures for this period yet. They arrive one to two days late.</p>
      ) : (
        <MetricExplorer metrics={metrics} label="Account metrics" echo />
      )}
    </Panel>
  );
}

function Audience({ profile }: { profile: TikTokBusinessProfile }) {
  const { ages, genders, countries } = profile.audience;
  const id = useId();
  if (!ages.length && !genders.length && !countries.length)
    return (
      <Panel labelledBy={id}>
        <SectionHeading id={id} level={2} title="Your followers" />
        <p style={muted}>TikTok shows follower demographics once an account has at least 100 followers.</p>
      </Panel>
    );
  return (
    <Panel labelledBy={id}>
      <SectionHeading id={id} level={2} title="Your followers" />
      <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        {ages.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>Age</h3>
            <ColumnBars label="Followers by age" rows={ages.map((a) => ({ key: a.key, label: a.key.replace(/^AGE_/, "").replace("_", "–"), share: a.share }))} />
          </div>
        )}
        {genders.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>Gender</h3>
            <Donut label="Followers by gender" segments={genderSegments(genders)} size={120} />
          </div>
        )}
        {countries.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>Top countries</h3>
            <RankBars rows={countries.slice(0, 5).map((c) => ({ key: c.key, label: countryName(c.key), share: c.share }))} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function Posts() {
  const [posts, setPosts] = useState<TikTokBusinessPost[] | "loading" | "failed">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const id = useId();
  const read = useCallback(async (): Promise<TikTokBusinessPost[] | "failed"> => {
    const res = await fetch("/api/portal/tiktok-business/posts", { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    return body?.posts ?? "failed";
  }, []);
  const show = useCallback((v: TikTokBusinessPost[] | "failed") => {
    setPosts(v);
    if (Array.isArray(v)) setSelected((s) => s ?? v[0]?.id ?? null);
  }, []);
  useEffect(() => {
    let live = true;
    read().then((v) => {
      if (live) show(v);
    });
    return () => {
      live = false;
    };
  }, [read, show]);
  const load = () => read().then(show);

  const post = Array.isArray(posts) ? posts.find((p) => p.id === selected) ?? null : null;
  return (
    <Panel labelledBy={id}>
      <SectionHeading id={id} level={2} title="Your posts" />
      {posts === "loading" && <SkeletonBlock height={220} />}
      {posts === "failed" && (
        <div>
          <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: "0 0 10px" }}>TikTok did not return your posts.</p>
          <Button variant="secondary" size="sm" onClick={() => { setPosts("loading"); load(); }}>Try again</Button>
        </div>
      )}
      {Array.isArray(posts) && posts.length === 0 && <p style={muted}>No posts on this account yet.</p>}
      {Array.isArray(posts) && posts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ul role="listbox" aria-label="Posts" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
            {posts.map((p) => {
              const on = p.id === selected;
              return (
                <li key={p.id} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => setSelected(p.id)}
                    aria-label={`${p.caption || "Post"}${p.views !== null ? `, ${formatCount(p.views)} views` : ""}`}
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "9 / 16",
                      padding: 0,
                      borderRadius: 10,
                      overflow: "hidden",
                      cursor: "pointer",
                      background: "var(--cc-hover-bg)",
                      border: on ? "2px solid var(--cc-plat-accent)" : "1px solid var(--cc-border)",
                      outlineOffset: 2,
                    }}
                  >
                    <Thumb src={p.thumbnailUrl} fill radius={0} fallback={<Film size={20} />} />
                    {p.views !== null && (
                      <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 7px 6px", display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: "var(--cc-plat-on-band)", background: "linear-gradient(to top, color-mix(in srgb, var(--cc-overlay-ink) 70%, transparent), transparent)", fontVariantNumeric: "tabular-nums" }}>
                        <Play size={11} aria-hidden="true" fill="currentColor" /> {formatCount(p.views)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {post && (
            <div style={{ borderTop: "1px solid var(--cc-border)", paddingTop: 20 }}>
              <PostDetail key={post.id} post={post} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** My TikTok for Business: the creator's own account as TikTok's Accounts
    API reports it, read live each visit and never saved. */
export default function TikTokBusinessPage() {
  return (
    <Suspense fallback={null}>
      <TikTokBusinessScreen />
    </Suspense>
  );
}

function TikTokBusinessScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const confirm = useConfirm();
  const [days, setDays] = useState<Days>("28");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [justConnected, setJustConnected] = useState(params.get("connected") === "1");

  const read = useCallback(async (d: Days): Promise<State | null> => {
    const res = await fetch(`/api/portal/tiktok-business?days=${d}`, { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) {
      router.replace("/portal/login");
      return null;
    }
    const body = res ? await res.json().catch(() => null) : null;
    if (res?.ok && body) return { kind: "ready", data: body };
    if (body?.error && body?.reason) return { kind: "refused", error: body.error, reason: body.reason };
    return { kind: "failed" };
  }, [router]);

  useEffect(() => {
    let live = true;
    read(days).then((v) => {
      if (live && v) setState(v);
    });
    return () => {
      live = false;
    };
  }, [read, days]);
  const load = (d: Days) =>
    read(d).then((v) => {
      if (v) setState(v);
    });

  const disconnect = async () => {
    const ok = await confirm({
      title: "Disconnect TikTok for Business?",
      description: "We revoke our access at TikTok and delete the keys we hold. Ad codes you already gave brands stay valid until they expire or you delete them on TikTok.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const res = await fetch("/api/portal/tiktok-business", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast.error("Could not disconnect. Try again.");
    toast.success("TikTok for Business disconnected");
    router.replace("/portal/accounts");
  };

  return (
    <Screen
      title="TikTok for Business"
      maxWidth={1080}
      action={
        state.kind === "ready" ? (
          <Button variant="ghost" size="sm" loading={busy} onClick={disconnect}>
            <Unplug size={14} aria-hidden="true" /> Disconnect
          </Button>
        ) : undefined
      }
    >
      {justConnected && (
        <Banner tone="success" onDismiss={() => setJustConnected(false)}>
          TikTok for Business is connected.
        </Banner>
      )}
      {state.kind === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SkeletonBlock height={110} />
          <SkeletonBlock height={320} />
        </div>
      )}
      {state.kind === "failed" && (
        <Banner tone="danger">
          Couldn&apos;t read your TikTok account.{" "}
          <button type="button" onClick={() => { setState({ kind: "loading" }); load(days); }} style={{ border: "none", background: "none", padding: 0, color: "inherit", fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>
            Try again
          </button>
        </Banner>
      )}
      {state.kind === "refused" && (
        <EmptyState
          title={state.error === "not_connected" ? "TikTok for Business isn't connected" : "Connect TikTok for Business again"}
          body={state.reason}
          action={{ label: "Go to My accounts", href: "/portal/accounts" }}
        />
      )}
      {state.kind === "ready" && (
        <div className="cc-plat-tiktok" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Header profile={state.data.profile} />
          <Analytics profile={state.data.profile} days={days} onDays={setDays} />
          <Audience profile={state.data.profile} />
          <Posts />
          <SourceLabel>From TikTok for Business · read {formatDay(state.data.readAt)} · not saved by Made Boring</SourceLabel>
        </div>
      )}
    </Screen>
  );
}
