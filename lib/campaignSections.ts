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
/* Ordered to CreatorCore's campaign rail. MEASURED 2026-09-14 off their own
   capture -- `campaign.rail` reads exactly
   "Overview / Creators / Drafts / Posts / Analytics / Financials / Documents /
   Settings" (8 rows, 50px pitch, zero gap).

   Their eight sit here in exactly that relative sequence. Performance and
   Reviews are ours alone -- they have no counterpart, and parity is not a reason
   to delete a feature -- so they slot beside Analytics, where a report belongs,
   rather than being wedged into their run and breaking it.

   Leading with Overview also makes the rail agree with the landing tab: before
   this, Performance led while CAMPAIGN_DEFAULT_SECTION resolved to a different
   row, so the first row was never the one you arrived on. */
export const CAMPAIGN_SECTIONS = [
  { value: "overview", label: "Overview", icon: ClipboardList },
  { value: "creators", label: "Creators", icon: Users, count: "creators" },
  { value: "drafts", label: "Drafts", icon: FileEdit, count: "drafts" },
  { value: "posts", label: "Posts", icon: FileText, count: "posts" },
  { value: "performance", label: "Performance", icon: Activity },
  { value: "reviews", label: "Reviews", icon: Star },
  { value: "analytics", label: "Analytics", icon: BarChart2 },
  { value: "financials", label: "Financials", icon: Wallet },
  { value: "documents", label: "Documents", icon: Folder },
  { value: "edit", label: "Settings", icon: Settings },
] as const;

export type CampaignSection = (typeof CAMPAIGN_SECTIONS)[number]["value"];

/** The counts the rail badges. Absent or zero renders no badge. */
export type CampaignSectionCounts = Partial<Record<"drafts" | "posts" | "creators", number>>;

/* Overview, to match CreatorCore.

   The brief said "if by default they are on posts page and not on performance
   we will also be on post page" -- the rule being "pair our default to theirs".
   MEASURED 2026-09-14, and the premise was wrong: theirs is neither Posts nor
   Performance. Opening a campaign the way a user does (campaigns list -> click
   the campaign name) lands on `&sub=Overview`, with Overview carrying the rail's
   active background. Verified on two campaigns (PLAYLIST (AUG), MONTAGEM KALI)
   and it is FIXED, not sticky -- PLAYLIST re-opens on Overview immediately after
   being navigated to Analytics. The control passes: clicking Analytics does move
   the highlight, so the resolver is reading real state.

   So the rule is applied to the real fact rather than the assumed one. This is
   deliberately NOT theme-scoped: which tab you land on is product behaviour, and
   a landing tab that changed when you toggled the theme would be a bug, not
   parity. One line to revert to "posts" if the preference was for Posts itself
   rather than for matching them. */
export const CAMPAIGN_DEFAULT_SECTION: CampaignSection = "overview";

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
