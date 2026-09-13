"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CAMPAIGN_SECTIONS, readCampaignSection } from "@/lib/campaignSections";
import { useCampaignNav } from "@/components/providers/CampaignNavProvider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
export default function CampaignRailNav({
  campaignId,
  isRail,
}: {
  campaignId: string;
  isRail: boolean;
}) {
  const searchParams = useSearchParams();
  const active = readCampaignSection(searchParams);
  const { title, counts } = useCampaignNav();

  const back = (
    <Link
      href="/campaigns"
      className="cc-nav-item sidebar-link"
      style={{
        justifyContent: isRail ? "center" : undefined,
        padding: isRail ? "10px" : undefined,
      }}
    >
      <ArrowLeft size={isRail ? 19 : 17} style={{ flexShrink: 0 }} aria-hidden="true" />
      {!isRail && <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>All campaigns</span>}
    </Link>
  );

  return (
    <>
      {isRail ? (
        <Tooltip>
          <TooltipTrigger render={back} />
          <TooltipContent side="right" sideOffset={8}>
            All campaigns
          </TooltipContent>
        </Tooltip>
      ) : (
        back
      )}

      <div style={{ height: 1, background: "var(--cc-border)", margin: "8px 8px" }} />

      {/* The campaign's own name, so the rail says which campaign these
          sections belong to. Truncated rather than wrapped: titles here run to
          "MONTAGEM KALI (BTS) — August" and a three-line label would push the
          sections themselves below the fold on a short window. */}
      {!isRail && (
        <div className="cc-nav-group-label" title={title ?? undefined}>
          {title ?? "Campaign"}
        </div>
      )}

      {CAMPAIGN_SECTIONS.map((section) => {
        const activeSection = active === section.value;
        const count = "count" in section ? counts[section.count] : undefined;
        const link = (
          <Link
            href={`/campaigns/${campaignId}?section=${section.value}`}
            className={`cc-nav-item sidebar-link ${activeSection ? "active btn-press" : ""}`}
            aria-current={activeSection ? "page" : undefined}
            style={{
              justifyContent: isRail ? "center" : undefined,
              padding: isRail ? "10px" : undefined,
            }}
          >
            <section.icon size={isRail ? 19 : 17} style={{ flexShrink: 0 }} aria-hidden="true" />
            {!isRail && (
              <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{section.label}</span>
            )}
            {/* A zero is not shown at all. "Posts 0" is the same information as
                no badge, and ten of them read as clutter on a new campaign. */}
            {!isRail && count ? (
              <span
                style={{
                  marginLeft: "auto",
                  background: activeSection ? "var(--cc-primary)" : "var(--cc-bg)",
                  color: activeSection ? "var(--primary-foreground)" : "var(--cc-text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 7px",
                  borderRadius: 999,
                }}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );

        if (!isRail) return <div key={section.value}>{link}</div>;

        return (
          <Tooltip key={section.value}>
            <TooltipTrigger render={link} />
            <TooltipContent side="right" sideOffset={8}>
              {section.label}
              {count ? ` (${count})` : ""}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
