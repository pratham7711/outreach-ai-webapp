"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { PlatformInsights } from "@/lib/portal/creatorInsights";
import { medianEngagementPerView, timesMedian, trendForAccount, type Trend } from "@/lib/portal/statsMath";
import { ButtonLink, EmptyState, LoadFailed, Screen, SkeletonBlock, SourceLabel, formatDay, platformLabel } from "@/components/portal/app/ui";
import { portalSignInHere } from "@/lib/callbackPath";
import { FigureStrip, Panel, SectionHeading, formatPercent, formatTimes, listWords, muted, type Figure } from "@/components/insights/parts";
import {
  AUDIENCE_MINIMUM_NOTE,
  AudienceSection,
  INSTAGRAM_LAG_NOTE,
  INSTAGRAM_LIVE_NOTE,
  InteractionsSection,
  StoriesSection,
  hasAudience,
  hasInteractions,
  hasLiveStories,
  instagramMissingNote,
  instagramWindowFigures,
  noStoriesNote,
  useInstagramInsights,
  type IgInsightsState,
} from "@/components/insights/instagramSections";
import { AccountHero, AccountSwitcher, atHandle, followerWord } from "@/components/portal/stats/AccountChrome";
import GrowthPanel from "@/components/portal/stats/GrowthPanel";
import PostGrid from "@/components/portal/stats/PostGrid";
import CampaignPosts, { type CampaignPost } from "@/components/portal/stats/CampaignPosts";

/** Every block says where its numbers came from, in the creator's words. */
const INSIGHTS_SOURCE: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "From TikTok · your connected account",
  INSTAGRAM: "From Instagram · insights",
  YOUTUBE: "From YouTube · your connected channel",
  FACEBOOK: "From Facebook · Page insights",
  THREADS: "From Threads · your connected account",
};

/** The headline figures from the account's recent posts: what a typical post
    gets, the best one against it, how much of an audience acts, and the total.
    A figure the platform's posts did not carry has no value, and the strip
    leaves it out (Facebook returns no views on a post it has no insights for). */
function postFigures(block: PlatformInsights): Figure[] {
  const n = block.sampleSize;
  const best = block.bestPost;
  const times = best ? timesMedian(best.views, block.medianViews, n) : null;
  const epv = medianEngagementPerView(block.posts);
  const last = `your last ${n} ${n === 1 ? "post" : "posts"}`;
  /* YouTube's Data API has no share count, so its rate is likes and comments only. */
  const counted = block.posts.some((p) => typeof p.shares === "number") ? "Likes, comments and shares" : "Likes and comments";
  return [
    { label: "Median views", value: block.medianViews, note: `A typical post, of ${last}` },
    {
      label: "Best post views",
      value: best?.views ?? null,
      note: times !== null ? `${formatTimes(times)} your typical post` : best ? `Posted ${formatDay(best.postedAt)}` : undefined,
    },
    {
      label: "Engagement per view",
      value: null,
      display: epv === null ? undefined : formatPercent(epv),
      note: `${counted} per view, median`,
      hint: `For each post, ${counted.toLowerCase()} divided by views; the median across your recent posts`,
    },
    block.platform === "INSTAGRAM"
      ? { label: "Median reach", value: block.medianReach, note: "Accounts reached by a typical post" }
      : { label: "Views in all", value: block.totalViews, note: `Across ${last}` },
  ];
}

const postsMissingNote = (platform: PlatformInsights["platform"]) => (labels: string[]) =>
  `${platformLabel(platform)} did not return ${listWords(labels).toLowerCase()} on these posts, so ${labels.length === 1 ? "it is" : "they are"} not shown.`;

function igData(ig: IgInsightsState | null) {
  return ig?.status === "read" ? ig.data : null;
}

/** One account's dashboard: who it is and its headline figures, how its
    audience has grown, its recent posts, and -- for Instagram -- who follows
    it, what they did, and the stories live now. */
function Dashboard({ block, trend, ig }: { block: PlatformInsights; trend: Trend | null; ig: IgInsightsState | null }) {
  const data = igData(ig);
  const epv = medianEngagementPerView(block.posts);
  const instagramLoading = ig?.status === "loading";
  const instagramFailed = ig?.status === "failed" ? ig.reason : null;
  const n = block.sampleSize;
  const audience = hasAudience(data);
  const interactions = hasInteractions(data);
  const side = instagramLoading || audience || interactions;

  let figures: ReactNode;
  if (data) {
    figures = (
      <>
        <SectionHeading title={`Account insights, last ${data.account.days} days`} aside={INSIGHTS_SOURCE.INSTAGRAM} />
        <FigureStrip figures={instagramWindowFigures(data, block.followers)} missing={instagramMissingNote} />
      </>
    );
  } else if (instagramLoading) {
    figures = (
      <div role="status">
        <SectionHeading title="Account insights" aside="Reading account and story insights from Instagram…" />
        <SkeletonBlock height={104} />
      </div>
    );
  } else {
    figures = (
      <>
        {instagramFailed && (
          <p role="alert" style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "0 0 12px" }}>
            {instagramFailed}
          </p>
        )}
        <SectionHeading title={`Your last ${n} ${n === 1 ? "post" : "posts"}`} aside={INSIGHTS_SOURCE[block.platform]} />
        <FigureStrip figures={postFigures(block)} missing={postsMissingNote(block.platform)} />
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel>
        <AccountHero block={block} />
        {block.needsReconnect ? (
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--cc-border)" }}>
            <p style={{ fontSize: 14, color: "var(--cc-text)", lineHeight: 1.5, margin: "0 0 14px" }}>
              Access to this account has lapsed, so we can&apos;t read its numbers. Reconnect it to see them again.
            </p>
            <ButtonLink href="/portal/accounts">Go to My accounts</ButtonLink>
          </div>
        ) : (
          <div style={{ marginTop: 24 }}>{n > 0 || data || instagramLoading ? figures : null}</div>
        )}
      </Panel>

      <GrowthPanel trend={trend} instagram={block.needsReconnect ? null : data} unit={followerWord(block.platform)} />

      {!block.needsReconnect &&
        (data || instagramLoading ? (
          <>
            <div className={`grid grid-cols-1 ${side ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""}`} style={{ gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                <Panel>
                  <PostGrid block={block} engagement={epv} />
                  {data && !hasLiveStories(data) && (
                    <p style={{ ...muted, fontSize: 12, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--cc-border)" }}>{noStoriesNote(data)}</p>
                  )}
                </Panel>
                {data ? (
                  hasLiveStories(data) && (
                    <Panel>
                      <StoriesSection data={data} />
                    </Panel>
                  )
                ) : (
                  <SkeletonBlock height={160} />
                )}
              </div>
              {side && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                  {data ? (
                    <>
                      {audience && (
                        <Panel>
                          <AudienceSection data={data} />
                        </Panel>
                      )}
                      {interactions && (
                        <Panel>
                          <InteractionsSection data={data} />
                        </Panel>
                      )}
                    </>
                  ) : (
                    <>
                      <SkeletonBlock height={300} />
                      <SkeletonBlock height={220} />
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <Panel>
            <PostGrid block={block} engagement={epv} />
          </Panel>
        ))}

      <SourceLabel>
        {INSIGHTS_SOURCE[block.platform]}
        {data && (
          <>
            {" "}· {INSTAGRAM_LIVE_NOTE} {INSTAGRAM_LAG_NOTE}
            {!audience && <> {AUDIENCE_MINIMUM_NOTE}</>}
          </>
        )}
      </SourceLabel>
    </div>
  );
}

/** An Instagram account reads its insights on mount. One read through Instagram
    Login has none to give, so it shows like any other platform. */
function InstagramDashboard({ block, trend }: { block: PlatformInsights; trend: Trend | null }) {
  const ig = useInstagramInsights(`/api/portal/insights/instagram?account=${encodeURIComponent(block.accountId)}`);
  const hidden = ig.status === "failed" && ig.error === "unsupported_login";
  return <Dashboard block={block} trend={trend} ig={hidden ? null : ig} />;
}

function AccountDashboard({ block, trends }: { block: PlatformInsights; trends: Trend[] }) {
  const trend = trendForAccount(trends, block.platform, block.handle);
  if (block.platform === "INSTAGRAM" && !block.needsReconnect) return <InstagramDashboard block={block} trend={trend} />;
  return <Dashboard block={block} trend={trend} ig={null} />;
}

/**
 * My stats: the creator's own numbers, each block labelled with where it came
 * from. Connected accounts are read live (/api/portal/insights); the followers
 * trend and campaign posts come from our own readings (/api/portal/stats). A
 * figure or chart the platform returned nothing for is left out, never drawn
 * as 0 or as an empty frame; where a headline figure is missing, one line says
 * which and why.
 *
 * With more than one account connected, the accounts are tabs and one is shown
 * at a time; every panel stays mounted (hidden, not unmounted), so switching
 * back never re-reads a platform. The chosen account is kept in ?account= so a
 * reload lands on it.
 */
export default function MyStatsPage() {
  const router = useRouter();
  const [insights, setInsights] = useState<PlatformInsights[] | null>(null);
  const [stats, setStats] = useState<{ trends: Trend[]; campaignPosts: CampaignPost[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [insRes, statsRes] = await Promise.all([fetch("/api/portal/insights"), fetch("/api/portal/stats")]);
      if (insRes.status === 401 || statsRes.status === 401) {
        router.push(portalSignInHere());
        return;
      }
      if (!insRes.ok || !statsRes.ok) throw new Error("stats");
      const ins = await insRes.json();
      setInsights(ins.platforms ?? []);
      setStats(await statsRes.json());
    } catch {
      setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    setChosen(new URLSearchParams(window.location.search).get("account"));
    load();
  }, [load]);

  const choose = (accountId: string) => {
    setChosen(accountId);
    const url = new URL(window.location.href);
    url.searchParams.set("account", accountId);
    window.history.replaceState(window.history.state, "", url);
  };

  const loading = !failed && (!insights || !stats);
  const nothing = insights && stats && insights.length === 0 && stats.trends.length === 0 && stats.campaignPosts.length === 0;
  /* Without a choice, open on the first account that has numbers to show
     rather than one waiting to be reconnected. */
  const active =
    insights?.find((b) => b.accountId === chosen) ?? insights?.find((b) => !b.needsReconnect) ?? insights?.[0] ?? null;
  const tabbed = (insights?.length ?? 0) > 1;
  /* Profiles our tracker reads that are not one of the connected accounts,
     drawn on their own so none of the creator's history goes missing. */
  const otherTrends = stats && insights ? stats.trends.filter((t) => !insights.some((b) => trendForAccount([t], b.platform, b.handle))) : [];

  return (
    <Screen title="My stats" maxWidth={1200}>
      {failed && <LoadFailed what="your stats" onRetry={load} />}
      {loading && (
        <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SkeletonBlock height={40} />
          <SkeletonBlock height={240} />
          <SkeletonBlock height={300} />
        </div>
      )}
      {nothing && (
        <EmptyState
          title="No numbers yet"
          body="Connect an account and its followers and recent posts show up here."
          action={{ label: "Connect an account", href: "/portal/accounts" }}
        />
      )}
      {insights && stats && !nothing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {insights.length > 0 && active ? (
            <div>
              {tabbed && <AccountSwitcher blocks={insights} selected={active.accountId} onSelect={choose} />}
              {insights.map((block) => (
                <div
                  key={block.accountId}
                  hidden={block.accountId !== active.accountId}
                  {...(tabbed
                    ? { role: "tabpanel", id: `stats-panel-${block.accountId}`, "aria-labelledby": `stats-tab-${block.accountId}` }
                    : {})}
                >
                  <AccountDashboard block={block} trends={stats.trends} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No connected accounts"
              action={{ label: "Connect an account", href: "/portal/accounts" }}
            />
          )}

          {otherTrends.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {otherTrends.map((t) => (
                <GrowthPanel
                  key={`${t.platform}-${t.handle}`}
                  trend={t}
                  instagram={null}
                  unit={followerWord(t.platform)}
                  title={`${platformLabel(t.platform)} · ${atHandle(t.handle)}`}
                />
              ))}
            </div>
          )}

          {stats.campaignPosts.length > 0 && <CampaignPosts posts={stats.campaignPosts} />}
        </div>
      )}
    </Screen>
  );
}
