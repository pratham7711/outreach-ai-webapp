"use client";

import { NavLink } from "@/components/layout/NavLink";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CAMPAIGN_SECTIONS, readCampaignSection, type CampaignSection } from "@/lib/campaignSections";
import { useCampaignNav } from "@/components/providers/CampaignNavProvider";

/**
 * The left rail while a campaign is open: its sections, in place of the global
 * nav.
 *
 * Ten sections in a horizontal strip inside the page measured ~1030px against a
 * 390px phone, so the one that was open regularly sat several hundred pixels
 * off-screen and the strip had to be scrolled into position on every render.
 * Down the rail they all fit, they carry their icons, and the section you are
 * in is visible without scrolling anything.
 *
 * Every section is a real link to ?section=<value>, not a button: middle-click
 * and copy-link work, and the back button walks the sections.
 */
export default function CampaignRailNav({ campaignId }: { campaignId: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  /* A post's own page sits under Posts. It carries no ?section, so it used to
     resolve to the default and mark Overview as where you are. */
  const active: CampaignSection = /^\/campaigns\/[^/]+\/posts\//.test(pathname ?? "")
    ? "posts"
    : readCampaignSection(searchParams);
  const { title, counts } = useCampaignNav();

  return (
    <>
      <NavLink href="/campaigns" className="cc-nav-item sidebar-link">
        <ArrowLeft size={17} style={{ flexShrink: 0 }} aria-hidden="true" />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>All campaigns</span>
      </NavLink>

      <div style={{ height: 1, background: "var(--cc-border)", margin: "8px 8px" }} />

      {/* The campaign's own name, so the rail says which campaign these
          sections belong to. Truncated rather than wrapped: titles here run to
          "MONTAGEM KALI (BTS) — August" and a three-line label would push the
          sections themselves below the fold on a short window. */}
      <div className="cc-nav-group-label" title={title ?? undefined}>
        {title ?? "Campaign"}
      </div>

      {CAMPAIGN_SECTIONS.filter((s) => s.value !== "drafts" || counts.draftsEver || active === "drafts").map((section) => {
        const activeSection = active === section.value;
        const count = "count" in section ? counts[section.count] : undefined;
        const href = `/campaigns/${campaignId}?section=${section.value}`;
        const link = (
          <NavLink
            href={href}
            onNavigate={(e) => {
              /* Another section of the campaign already open. The page is a
                 client component that reads ?section itself, so a server round
                 trip sends nothing new -- and that round trip is what stalled
                 for 10-14s on prod (MEASURED 2026-10-03: the requests reached
                 Vercel that long after the click, then took under a second).
                 The router syncs a native pushState into useSearchParams, so
                 the switch is immediate and the back button still walks the
                 sections. */
              if (pathname !== `/campaigns/${campaignId}`) return;
              e.preventDefault();
              window.history.pushState(null, "", href);
              document.getElementById("main-content")?.scrollTo({ top: 0 });
            }}
            className={`cc-nav-item sidebar-link ${activeSection ? "active btn-press" : ""}`}
            aria-current={activeSection ? "page" : undefined}
          >
            <section.icon size={17} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{section.label}</span>
            {/* A zero is not shown at all. "Posts 0" is the same information as
                no badge, and ten of them read as clutter on a new campaign. */}
            {count ? (
              <span
                style={{
                  marginLeft: "auto",
                  background: activeSection ? "var(--cc-primary)" : "var(--cc-bg)",
                  color: activeSection ? "var(--primary-foreground)" : "var(--cc-text-muted)",
                  fontSize: "var(--cc-t-10)",
                  fontWeight: 700,
                  /* The badge inherits the row's 20px line-height while setting
                     10px text, so its box measured 20+2+2 = 24px -- taller than
                     the 20px label, which made it the tallest flex item and grew
                     the whole row from 40px to 44px. MEASURED: only the two rows
                     carrying counts were 44px, so the rail's pitch alternated
                     48/52 against CreatorCore's uniform 50. A 10px badge does
                     not need a 20px line box. */
                  lineHeight: 1,
                  padding: "2px 7px",
                  borderRadius: 999,
                }}
              >
                {count}
              </span>
            ) : null}
          </NavLink>
        );

        return <div key={section.value}>{link}</div>;
      })}
    </>
  );
}
