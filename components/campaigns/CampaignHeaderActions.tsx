"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const CAMPAIGN_HEADER_ACTIONS_ID = "campaign-header-actions";

/**
 * Puts a campaign section's own actions into the campaign page header.
 *
 * MEASURED 2026-09-14 at desktop-1600 against the reference: their campaign
 * header card carries the section's primary action on its right edge on every
 * section -- `Add Posts` (x=1332 y=42.5 w=200 h=45), `Add Creator`, `Add Draft`,
 * `Add Document` -- while ours rendered the same buttons inside the section
 * body, below the filter row. The parity harness reported ZERO differences for
 * it, because `page.primary-action` resolved on their side and UNRESOLVED on
 * ours, and an unresolved landmark was counted as "not measured" rather than as
 * a difference. Nine surfaces were hidden that way.
 *
 * A portal rather than lifted state: the buttons own local state that has no
 * business on the page (a refresh in flight, an open add-modal, which rows are
 * selected), and hoisting it would move four tabs' worth of state up one level
 * to change where two nodes paint. The host is rendered by the campaign page
 * itself, which is the only page that renders these sections.
 */
export function CampaignHeaderActions({ children }: { children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  /* After mount, not during render: the host is in the same tree and is not in
     the DOM while this component's first render runs. */
  useEffect(() => {
    setHost(document.getElementById(CAMPAIGN_HEADER_ACTIONS_ID));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
