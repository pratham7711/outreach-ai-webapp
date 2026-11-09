"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { InvitedCampaign, JoinedCampaign } from "@/lib/portal/myCampaigns";
import type { MarketplaceCardDTO } from "@/lib/marketplace/public";
import { Button } from "@/components/ds";
import {
  EmptyState,
  LoadFailed,
  Screen,
  SkeletonBlock,
  StatusPill,
  formatCount,
  formatDay,
  platformLabel,
  relativeDay,
  secondaryButtonStyle,
} from "@/components/portal/app/ui";
import { CampaignRow } from "@/components/portal/app/CampaignRow";
import { portalSignInHere } from "@/lib/callbackPath";

const TABS = [
  { key: "joined", label: "Joined" },
  { key: "invited", label: "Invited" },
  { key: "open", label: "Open" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function isTab(v: string | null): v is TabKey {
  return v === "joined" || v === "invited" || v === "open";
}

function Tabs({ active, counts }: { active: TabKey; counts: Partial<Record<TabKey, number>> }) {
  const router = useRouter();
  return (
    <div
      role="tablist"
      aria-label="Campaigns"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: "var(--cc-hover-bg)",
        border: "1px solid var(--cc-border)",
        marginBottom: 16,
      }}
    >
      {TABS.map((t) => {
        const selected = t.key === active;
        const count = counts[t.key];
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => router.replace(`/portal/campaigns?tab=${t.key}`, { scroll: false })}
            style={{
              padding: "8px 6px",
              borderRadius: 9,
              border: selected ? "1px solid var(--cc-border)" : "1px solid transparent",
              background: selected ? "var(--cc-seg-active-bg)" : "transparent",
              color: selected ? "var(--cc-seg-active-fg)" : "var(--cc-text-muted)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t.label}
            {typeof count === "number" && count > 0 ? ` (${count})` : ""}
          </button>
        );
      })}
    </div>
  );
}

function OpenCampaign({ c }: { c: MarketplaceCardDTO }) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);

  /* One path for the open marketplace: Join, here, joins. It used to send a
     "proposal" from Discover, which an agency then had to accept; that step is
     gone from the creator app. */
  const join = async () => {
    setJoining(true);
    try {
      const res = await fetch("/api/portal/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: c.slug }),
      });
      if (res.status === 401) {
        router.push(`/portal/login?join=${encodeURIComponent(c.slug)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't join this campaign");
        return;
      }
      toast.success(data.alreadyJoined ? "You're already on this campaign" : "You've joined");
      router.push(`/portal/campaigns/${encodeURIComponent(data.campaignSlug ?? c.slug)}`);
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setJoining(false);
    }
  };

  const platforms = c.rates.map((r) => platformLabel(r.platform)).join(" · ");
  return (
    <div
      style={{
        padding: 14,
        borderRadius: "var(--cc-r-card)",
        border: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>{c.title}</div>
          <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c.orgName}</div>
        </div>
        {c.daysLeft !== null && c.daysLeft <= 7 && (
          <StatusPill tone="warning">{c.daysLeft === 1 ? "1 day left" : `${c.daysLeft} days left`}</StatusPill>
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 8, lineHeight: 1.5 }}>
        {platforms && <>{platforms} · </>}
        {formatCount(c.creatorCount)} {c.creatorCount === 1 ? "creator" : "creators"}
        {c.submissionDeadline && (
          <> · submit by {formatDay(c.submissionDeadline)} ({relativeDay(c.submissionDeadline)})</>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" loading={joining} onClick={join}>
          Join
        </Button>
        <Link href={`/portal/campaigns/${encodeURIComponent(c.slug)}`} className="rsp-touch" style={{ ...secondaryButtonStyle, minHeight: 32, padding: "6px 12px", fontSize: 13 }}>
          Details
        </Link>
      </div>
    </div>
  );
}

function CampaignsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const active: TabKey = isTab(tabParam) ? tabParam : "joined";

  const [mine, setMine] = useState<{ joined: JoinedCampaign[]; invited: InvitedCampaign[] } | null>(null);
  const [mineFailed, setMineFailed] = useState(false);
  const [open, setOpen] = useState<MarketplaceCardDTO[] | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  const loadMine = useCallback(async () => {
    setMineFailed(false);
    try {
      const res = await fetch("/api/portal/campaigns");
      if (res.status === 401) {
        router.push(portalSignInHere());
        return;
      }
      if (!res.ok) throw new Error("campaigns");
      setMine(await res.json());
    } catch {
      setMineFailed(true);
    }
  }, [router]);

  const loadOpen = useCallback(async () => {
    setOpenFailed(false);
    try {
      const res = await fetch("/api/public/marketplace?pageSize=48");
      if (!res.ok) throw new Error("marketplace");
      const data = await res.json();
      setOpen(data.campaigns ?? []);
    } catch {
      setOpenFailed(true);
    }
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (active === "open" && open === null) loadOpen();
  }, [active, open, loadOpen]);

  /* Open lists every marketplace campaign; one the creator is already on
     belongs under Joined, not offered again. */
  const joinedIds = new Set((mine?.joined ?? []).map((c) => c.href.split("/").pop()));
  const openNotJoined = (open ?? []).filter((c) => !joinedIds.has(encodeURIComponent(c.slug)));

  return (
    <Screen title="Campaigns" subtitle="The ones you're on, the ones you're invited to, and open ones anyone can join.">
      <Tabs active={active} counts={{ joined: mine?.joined.length, invited: mine?.invited.length }} />

      <div role="tabpanel" aria-label={TABS.find((t) => t.key === active)?.label}>
        {active !== "open" && mineFailed && <LoadFailed what="your campaigns" onRetry={loadMine} />}
        {active !== "open" && !mine && !mineFailed && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        )}

        {active === "joined" && mine && (
          mine.joined.length === 0 ? (
            <EmptyState
              title="You're not on a campaign yet"
              body="Join an open campaign, or accept an agency's invite."
              action={{ label: "See open campaigns", href: "/portal/campaigns?tab=open" }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {mine.joined.map((c) => (
                <CampaignRow key={c.campaignId} c={c} />
              ))}
            </div>
          )
        )}

        {active === "invited" && mine && (
          mine.invited.length === 0 ? (
            <EmptyState
              title="No invitations right now"
              body="When an agency invites you to a campaign, it shows up here."
              action={{ label: "See open campaigns", href: "/portal/campaigns?tab=open" }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {mine.invited.map((inv) => (
                <Link
                  key={inv.campaignId}
                  href={inv.href}
                  style={{
                    display: "block",
                    padding: 14,
                    borderRadius: "var(--cc-r-card)",
                    border: "1px solid var(--cc-border)",
                    background: "var(--cc-card)",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>{inv.title}</span>
                      <span style={{ display: "block", fontSize: 13, color: "var(--cc-text-muted)" }}>
                        {inv.orgName} · invited {formatDay(inv.invitedAt)}
                      </span>
                    </span>
                    <StatusPill tone="info">Respond</StatusPill>
                  </div>
                  {inv.submissionDeadline && (
                    <div style={{ fontSize: 13, color: "var(--cc-text)", marginTop: 8 }}>
                      Submissions close {formatDay(inv.submissionDeadline)} ({relativeDay(inv.submissionDeadline)})
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )
        )}

        {active === "open" && (
          <>
            {openFailed && <LoadFailed what="open campaigns" onRetry={loadOpen} />}
            {!open && !openFailed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SkeletonBlock />
                <SkeletonBlock />
              </div>
            )}
            {open &&
              (openNotJoined.length === 0 ? (
                <EmptyState
                  title="No open campaigns right now"
                  body="New ones appear here as agencies publish them. Your joined campaigns are under Joined."
                  action={{ label: "See your campaigns", href: "/portal/campaigns?tab=joined" }}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {openNotJoined.map((c) => (
                    <OpenCampaign key={c.slug} c={c} />
                  ))}
                </div>
              ))}
          </>
        )}
      </div>
    </Screen>
  );
}

export default function CreatorCampaignsPage() {
  return (
    <Suspense fallback={null}>
      <CampaignsScreen />
    </Suspense>
  );
}
