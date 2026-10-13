"use client";

import { useSyncExternalStore } from "react";

/**
 * Where "Close campaign" and the rail's "All campaigns" go back to.
 *
 * Both were a fixed /campaigns. A bare /campaigns opens the Active tab, so
 * someone who opened a campaign from All (?status=ALL), page 4, or a search was
 * returned to a different list from the one they left and had to rebuild it.
 * The list page records its own URL here as it changes; the two links read it.
 *
 * Per tab (sessionStorage), and only ever a /campaigns list URL: anything else
 * stored under the key -- by an older build or by hand -- is ignored, so the
 * links can never be pointed somewhere else.
 */
const KEY = "cc:campaigns:listUrl";
const LIST_URL = /^\/campaigns(\?[^#\\]*)?$/;

export function rememberCampaignList(url: string): void {
  if (!LIST_URL.test(url)) return;
  try {
    window.sessionStorage.setItem(KEY, url);
  } catch {
    /* Storage refused (privacy mode): the links fall back to /campaigns. */
  }
}

export function campaignListHref(): string {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored && LIST_URL.test(stored)) return stored;
  } catch {
    /* As above. */
  }
  return "/campaigns";
}

/* Nothing to subscribe to: the value is only written by the list page, which
   is never on screen at the same time as the links that read it. */
const noSubscription = () => () => {};

/** "/campaigns" on the server and while hydrating, then the remembered list. */
export function useCampaignListHref(): string {
  return useSyncExternalStore(noSubscription, campaignListHref, () => "/campaigns");
}
