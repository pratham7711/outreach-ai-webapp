"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ds";
import { action } from "@/lib/ui/actions";
import { ShareModal } from "@/app/(dashboard)/campaigns/ShareModal";

/**
 * Share Campaign, on every page of a campaign.
 *
 * It used to live only inside the Performance tab, so sending a client the
 * report meant remembering which of seven sections the button was on. The
 * reference carries it in the campaign header on every section, first in the
 * cluster -- "Share Campaign / Refresh Data / Add <thing>" -- and the campaign
 * page renders this there; a post's own page renders it beside its actions.
 *
 * The dialog is the one the campaigns list opens, not a copy: ShareModal is
 * what knows that PATCH keeps the token while POST rotates it. Its Modal
 * portals to document.body, so opening it adds nothing to the header row.
 */
export function CampaignShareButton({
  campaignId,
  campaignTitle,
}: {
  campaignId: string;
  campaignTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The label is its own span so a phone's three-action row can drop it
          and keep the glyph (globals.css, cc-share); aria-label keeps the
          button's name when it does. */}
      <Button
        variant="secondary"
        iconLeft={<Share2 size={16} />}
        onClick={() => setOpen(true)}
        aria-label="Share campaign"
        {...action("share-campaign")}
      >
        <span className="cc-share-label">Share campaign</span>
      </Button>
      {open && (
        <ShareModal campaignId={campaignId} campaignTitle={campaignTitle} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
