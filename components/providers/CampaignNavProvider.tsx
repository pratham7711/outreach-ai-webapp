"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { CampaignSectionCounts } from "@/lib/campaignSections";

/**
 * What the campaign rail knows about the campaign it is showing.
 *
 * The rail lives in the dashboard layout and the campaign's data is fetched by
 * the page below it, so the title and the per-section counts have to travel
 * upwards. Publishing them through a context keeps the single fetch the page
 * already does: the alternative was the sidebar fetching the same campaign a
 * second time on every navigation, to render two numbers.
 *
 * Both fields are null until the page has loaded. The rail renders the sections
 * regardless -- a section list that waited for counts would flash an empty rail
 * on every campaign open.
 */
type CampaignNavContextType = {
  title: string | null;
  counts: CampaignSectionCounts;
  publish: (value: { title: string | null; counts: CampaignSectionCounts }) => void;
};

const CampaignNavContext = createContext<CampaignNavContextType>({
  title: null,
  counts: {},
  publish: () => {},
});

export function useCampaignNav() {
  return useContext(CampaignNavContext);
}

export function CampaignNavProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title: string | null; counts: CampaignSectionCounts }>({
    title: null,
    counts: {},
  });

  /* Compared before storing. The campaign page recomputes its counts on every
     render, so publishing unconditionally put the provider and the page in a
     set-state loop the first time this was wired up. */
  const publish = useCallback((next: { title: string | null; counts: CampaignSectionCounts }) => {
    setState((prev) =>
      prev.title === next.title &&
      prev.counts.drafts === next.counts.drafts &&
      prev.counts.posts === next.counts.posts &&
      prev.counts.creators === next.counts.creators
        ? prev
        : next
    );
  }, []);

  const value = useMemo(
    () => ({ title: state.title, counts: state.counts, publish }),
    [state, publish]
  );

  return <CampaignNavContext.Provider value={value}>{children}</CampaignNavContext.Provider>;
}
