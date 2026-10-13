"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Link2, MessageSquareText, Upload } from "lucide-react";
import type { HomeTodo, InvitedCampaign, JoinedCampaign } from "@/lib/portal/myCampaigns";
import {
  Card,
  EmptyState,
  LoadFailed,
  Screen,
  SectionTitle,
  SkeletonBlock,
  StatusPill,
  formatDay,
  relativeDay,
} from "@/components/portal/app/ui";
import { CampaignRow } from "@/components/portal/app/CampaignRow";
import { portalSignInHere } from "@/lib/callbackPath";

type HomeData = {
  name: string;
  todo: HomeTodo[];
  campaigns: JoinedCampaign[];
  invited: InvitedCampaign[];
  connectedAccounts: number;
};

const TODO_ICON = { connect: Link2, post_due: Upload, draft_feedback: MessageSquareText } as const;

function TodoRow({ item }: { item: HomeTodo }) {
  const Icon = TODO_ICON[item.kind];
  const detail =
    item.kind === "connect"
      ? "So your posts report their own numbers."
      : item.kind === "post_due"
        ? `${item.campaignTitle}${item.dueAt ? ` · due ${formatDay(item.dueAt)} (${relativeDay(item.dueAt)})` : ""}`
        : `${item.campaignTitle} · “${item.feedback}”`;
  return (
    <Link
      href={item.href}
      className="rsp-touch"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 4px",
        textDecoration: "none",
        color: "inherit",
        borderBottom: "1px solid var(--cc-border)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--cc-primary-light)",
          color: "var(--cc-primary)",
        }}
      >
        <Icon size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>{item.title}</span>
        <span
          style={{
            display: "block",
            fontSize: 13,
            color: "var(--cc-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </span>
      </span>
      <ChevronRight size={18} aria-hidden="true" style={{ color: "var(--cc-text-muted)", flexShrink: 0 }} />
    </Link>
  );
}

/**
 * Home: what needs doing, in order -- connect an account, posts due, drafts
 * with feedback -- and then every campaign with its next date. The order is
 * decided on the server (lib/portal/myCampaigns.ts, buildHomeTodo) so this page
 * only lays it out.
 */
export default function CreatorHomePage() {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/portal/home");
      if (res.status === 401) {
        router.push(portalSignInHere());
        return;
      }
      if (!res.ok) throw new Error("home");
      setData(await res.json());
    } catch {
      setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = data?.name?.split(/\s+/)[0];

  return (
    <Screen title={firstName ? `Hi, ${firstName}` : "Home"} subtitle="What needs doing, then your campaigns.">
      {failed && <LoadFailed what="your home screen" onRetry={load} />}
      {!data && !failed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonBlock height={140} />
          <SkeletonBlock />
          <SkeletonBlock />
        </div>
      )}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Card>
            <SectionTitle>To do</SectionTitle>
            {data.todo.length === 0 ? (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
                You&apos;re all caught up. New dates and feedback show up here.
              </p>
            ) : (
              <div style={{ marginBottom: -1 }}>
                {data.todo.map((item, i) => (
                  <TodoRow key={`${item.kind}-${item.href}-${i}`} item={item} />
                ))}
              </div>
            )}
          </Card>

          {data.invited.length > 0 && (
            <div>
              <SectionTitle aside={<Link href="/portal/campaigns?tab=invited" style={{ fontSize: 13, color: "var(--cc-primary)" }}>See all</Link>}>
                Invitations
              </SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.invited.slice(0, 3).map((inv) => (
                  <Link
                    key={inv.campaignId}
                    href={inv.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid var(--cc-border)",
                      background: "var(--cc-card)",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>{inv.title}</span>
                      <span style={{ display: "block", fontSize: 13, color: "var(--cc-text-muted)" }}>{inv.orgName} invited you</span>
                    </span>
                    <StatusPill tone="info">Respond</StatusPill>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionTitle>Your campaigns</SectionTitle>
            {data.campaigns.length === 0 ? (
              <EmptyState
                title="You're not on a campaign yet"
                body="Open campaigns take anyone who joins. An agency's invite link brings you straight to theirs."
                action={{ label: "Find a campaign", href: "/portal/campaigns?tab=open" }}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.campaigns.map((c) => (
                  <CampaignRow key={c.campaignId} c={c} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Screen>
  );
}
