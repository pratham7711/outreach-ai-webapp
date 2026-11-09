"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { NavLink } from "@/components/layout/NavLink";
import { CAMPAIGN_SECTIONS } from "@/lib/campaignSections";
import { useCampaignNav } from "@/components/providers/CampaignNavProvider";
import { switchSection, useActiveSection } from "@/components/CampaignRailNav";

/**
 * A campaign's sections on a phone, as a row of tabs under its header. On a
 * desktop they are the left rail; below 768px the rail is a drawer behind
 * More, which put Posts two taps and a hunt away. Labels only, no icons, so
 * the row is about half the width the old in-page strip measured, and the
 * open one is scrolled into view. Hidden from 768px up by the stylesheet.
 */
export function CampaignPhoneTabs({ campaignId }: { campaignId: string }) {
  const pathname = usePathname();
  const active = useActiveSection();
  const { counts } = useCampaignNav();
  const row = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>("[aria-current='page']");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav ref={row} className="cc-campaign-phone-tabs" aria-label="Campaign sections">
      {CAMPAIGN_SECTIONS.filter((s) => s.value !== "drafts" || counts.draftsEver || active === "drafts").map((section) => {
        const href = `/campaigns/${campaignId}?section=${section.value}`;
        const count = "count" in section ? counts[section.count] : undefined;
        const on = active === section.value;
        return (
          <NavLink
            key={section.value}
            href={href}
            onNavigate={(e) => switchSection(e, pathname, campaignId, href)}
            className="cc-campaign-phone-tab"
            aria-current={on ? "page" : undefined}
          >
            {section.label}
            {count ? <span className="cc-campaign-phone-tab-count">{count}</span> : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
