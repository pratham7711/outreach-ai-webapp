"use client";

import { Suspense, useCallback, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Film, Unplug } from "lucide-react";
import type { DailyMetrics, TikTokBusinessPost, TikTokBusinessProfile } from "@/lib/platforms/tiktokBusiness";
import type { TikTokBusinessSummary } from "@/lib/portal/tiktokBusinessConnection";
import { Button, useConfirm } from "@/components/ds";
import { Banner, EmptyState, Screen, SkeletonBlock, SourceLabel, StatusPill, formatCount, formatDay, type Tone } from "@/components/portal/app/ui";
import { ColumnBars, FigureStrip, Panel, RankBars, SectionHeading, SplitBar, Thumb, Toggle, muted, type Figure } from "@/components/insights/parts";
import { DailyBarChart, TotalAreaChart, type DayValue } from "@/components/insights/charts";
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

function Header({ profile, onDisconnect, busy }: { profile: TikTokBusinessProfile; onDisconnect: () => void; busy: boolean }) {
  const type = ACCOUNT_TYPE[profile.accountType];
  return (
    <Panel style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <Thumb src={profile.avatarUrl} width={64} height={64} radius={32} />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{profile.displayName || `@${profile.username}`}</h2>
          {profile.isVerified && <BadgeCheck size={18} aria-label="Verified" style={{ color: "var(--cc-primary)" }} />}
        </div>
        <p style={{ ...muted, fontSize: 13, margin: "2px 0 8px" }}>
          {profile.profileUrl ? (
            <a href={profile.profileUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>@{profile.username}</a>
          ) : (
            `@${profile.username}`
          )}
        </p>
        <StatusPill tone={type.tone}>{type.text}</StatusPill>
      </div>
      <dl style={{ display: "flex", gap: 20, margin: 0, flexWrap: "wrap" }}>
        {[
          ["Followers", profile.followers],
          ["Following", profile.following],
          ["Likes", profile.totalLikes],
          ["Videos", profile.videos],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>{v === null ? "—" : formatCount(v as number)}</dd>
          </div>
        ))}
      </dl>
      <Button variant="ghost" size="sm" loading={busy} onClick={onDisconnect}>
        <Unplug size={14} aria-hidden="true" /> Disconnect
      </Button>
    </Panel>
  );
}

function Analytics({ profile, days, onDays }: { profile: TikTokBusinessProfile; days: Days; onDays: (d: Days) => void }) {
  const views = series(profile.daily, (d) => d.videoViews);
  const profileViews = series(profile.daily, (d) => d.profileViews);
  const followers = series(profile.daily, (d) => d.followers);
  const gained = series(profile.daily, (d) => d.newFollowers);
  const lost = series(profile.daily, (d) => d.lostFollowers);
  const net = sum(gained) !== null && sum(lost) !== null ? sum(gained)! - sum(lost)! : null;
  const figures: Figure[] = [
    { label: "Video views", value: sum(views) },
    { label: "Profile views", value: sum(profileViews) },
    { label: "New followers", value: sum(gained) },
    { label: "Net followers", value: null, display: net === null ? undefined : `${net >= 0 ? "+" : "−"}${formatCount(Math.abs(net))}` },
    { label: "Likes", value: sum(series(profile.daily, (d) => d.likes)) },
    { label: "Shares", value: sum(series(profile.daily, (d) => d.shares)) },
  ];
  const id = useId();
  return (
    <Panel labelledBy={id}>
      <SectionHeading id={id} level={2} title="Account analytics" aside={<Toggle label="Period" options={WINDOWS} value={days} onChange={onDays} />} />
      <FigureStrip figures={figures} missing={(l) => `TikTok did not return ${l.join(", ").toLowerCase()} for this period.`} />
      {profile.daily.length === 0 ? (
        <p style={{ ...muted, marginTop: 16 }}>TikTok has no daily figures for this period yet. They arrive one to two days late.</p>
      ) : (
        <div style={{ display: "grid", gap: 24, marginTop: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          {views.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>Video views by day</h3>
              <DailyBarChart points={views} label="Video views by day" describe={(v) => `${formatCount(v)} views`} />
            </div>
          )}
          {followers.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>Followers</h3>
              <TotalAreaChart points={followers} label="Followers by day" unit="followers" />
            </div>
          )}
          {gained.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>New followers by day</h3>
              <DailyBarChart points={gained} label="New followers by day" describe={(v) => `+${formatCount(v)} new followers`} />
            </div>
          )}
          {profileViews.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>Profile views by day</h3>
              <DailyBarChart points={profileViews} label="Profile views by day" describe={(v) => `${formatCount(v)} profile views`} />
            </div>
          )}
        </div>
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
            <SplitBar label="Followers by gender" segments={genderSegments(genders)} />
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
          <ul role="listbox" aria-label="Posts" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))" }}>
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
                      border: on ? "2px solid var(--cc-primary)" : "1px solid var(--cc-border)",
                      outlineOffset: 2,
                    }}
                  >
                    <Thumb src={p.thumbnailUrl} fill radius={0} fallback={<Film size={20} />} />
                    {p.views !== null && (
                      <span style={{ position: "absolute", left: 6, bottom: 6, padding: "2px 6px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "var(--cc-card)", color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>
                        {formatCount(p.views)}
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
    <Screen title="TikTok for Business" maxWidth={1080}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Header profile={state.data.profile} onDisconnect={disconnect} busy={busy} />
          <Analytics profile={state.data.profile} days={days} onDays={setDays} />
          <Audience profile={state.data.profile} />
          <Posts />
          <SourceLabel>From TikTok for Business · read {formatDay(state.data.readAt)} · not saved by Made Boring</SourceLabel>
        </div>
      )}
    </Screen>
  );
}
