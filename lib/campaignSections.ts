import {
  Activity, ClipboardList, FileEdit, FileText, Users, Star, BarChart2, Wallet, Folder, Settings,
} from "lucide-react";

/**
 * The sections of a single campaign, and the one list they are read off.
 *
 * These used to be a tab strip inside the page. They are now the left rail:
 * opening a campaign swaps the global nav for this list, the way the reference
 * app does it, so ten sections stop competing for one horizontal line that
 * scrolled sideways on anything narrower than a laptop.
 *
 * Two consumers share it -- NewSidebar renders it, and the campaign page
 * switches its panel on it -- so a section added here is navigable and
 * rendered, or neither. A hand-written union in the page was how /reviews and
 * /financials came to type-check while silently falling back to Performance.
 */
export const CAMPAIGN_SECTIONS = [
  { value: "performance", label: "Performance", icon: Activity },
  { value: "overview", label: "Overview", icon: ClipboardList },
  { value: "drafts", label: "Drafts", icon: FileEdit, count: "drafts" },
  { value: "posts", label: "Posts", icon: FileText, count: "posts" },
  { value: "creators", label: "Creators", icon: Users, count: "creators" },
  { value: "reviews", label: "Reviews", icon: Star },
  { value: "analytics", label: "Analytics", icon: BarChart2 },
  { value: "financials", label: "Financials", icon: Wallet },
  { value: "documents", label: "Documents", icon: Folder },
  { value: "edit", label: "Settings", icon: Settings },
] as const;

export type CampaignSection = (typeof CAMPAIGN_SECTIONS)[number]["value"];

/** The counts the rail badges. Absent or zero renders no badge. */
export type CampaignSectionCounts = Partial<Record<"drafts" | "posts" | "creators", number>>;

/* Posts, not Performance. Opening a campaign, the question is almost always
   "what has gone out" -- the report is what you go to afterwards. */
export const CAMPAIGN_DEFAULT_SECTION: CampaignSection = "posts";

export function campaignSectionFromParam(raw: string | null): CampaignSection {
  return CAMPAIGN_SECTIONS.some((s) => s.value === raw)
    ? (raw as CampaignSection)
    : CAMPAIGN_DEFAULT_SECTION;
}

/**
 * The campaign id when the path is one campaign's own page, else null.
 *
 * /campaigns is the list and /campaigns/new and /campaigns/self-serve are
 * wizards -- none of them has sections, so none of them may take the rail over.
 * Anything deeper (/campaigns/<id>/posts/<postId>) is still inside the campaign
 * and keeps the rail, which is why this matches a prefix rather than the whole
 * path.
 */
export function campaignIdFromPathname(pathname: string): string | null {
  const m = /^\/campaigns\/([^/]+)/.exec(pathname);
  if (!m) return null;
  const id = m[1];
  return id === "new" || id === "self-serve" ? null : id;
}

/**
 * The open section, read off the URL.
 *
 * `?section=` is the name now that these are rail items; `?tab=` is still
 * honoured because that was the parameter while they were tabs and links to it
 * exist outside the app -- a shared link that silently landed on Performance
 * would look like the link was wrong.
 */
export function readCampaignSection(sp: { get(key: string): string | null }): CampaignSection {
  return campaignSectionFromParam(sp.get("section") ?? sp.get("tab"));
}
