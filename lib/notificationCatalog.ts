/**
 * The notifiable-event catalog, kept apart from lib/notifications.ts because
 * that module imports the Prisma client to fan an event out. Three readers now
 * need only the catalog — the settings screen, the Slack route and the top
 * bar's bell — and the bell is a client component, which must not pull Prisma
 * into the browser bundle.
 */

export type NotificationGroup = "Campaigns" | "Creators & Lists" | "Financial";

export type NotificationEventDef = {
  /** The logAudit action string this row listens for. */
  key: string;
  label: string;
  description: string;
  group: NotificationGroup;
  /** What an untouched account gets. Mirrors the reference's defaults. */
  defaultOn: boolean;
  glyph: string;
};

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  // Campaigns — the reference's headline group.
  { key: "campaign.create", label: "Campaign Created", description: "A new campaign is created", group: "Campaigns", defaultOn: true, glyph: "🎉" },
  { key: "campaign.update", label: "Campaign Updated", description: "A campaign's status or details change", group: "Campaigns", defaultOn: true, glyph: "💡" },
  { key: "campaign.delete", label: "Campaign Deleted", description: "A campaign is deleted", group: "Campaigns", defaultOn: false, glyph: "🗑️" },
  { key: "activation.create", label: "Creator Added", description: "A creator is added to a campaign", group: "Campaigns", defaultOn: true, glyph: "➕" },
  { key: "activation.delete", label: "Creator Removed", description: "A creator is removed from a campaign", group: "Campaigns", defaultOn: true, glyph: "➖" },
  { key: "activation.update", label: "Activation Status Updated", description: "A creator's activation moves between statuses", group: "Campaigns", defaultOn: false, glyph: "🌀" },
  { key: "post.create", label: "Post Uploaded", description: "A post is added to a campaign", group: "Campaigns", defaultOn: false, glyph: "🤳" },
  { key: "post.auto_approved", label: "Post Auto-Approved", description: "The sync sweep approves a post automatically. Fires once per post — noisy on active campaigns", group: "Campaigns", defaultOn: false, glyph: "🤖" },
  { key: "comment.create", label: "Comment", description: "Someone comments on a campaign", group: "Campaigns", defaultOn: true, glyph: "💬" },
  { key: "document.create", label: "Document Added", description: "A document is attached to a campaign", group: "Campaigns", defaultOn: false, glyph: "📄" },

  // Creators & Lists — the reference's "Lists" section, widened to creators.
  { key: "creator.create", label: "Creator Created", description: "A creator is added to the roster", group: "Creators & Lists", defaultOn: false, glyph: "🧑‍🎤" },
  { key: "list.create", label: "List Created", description: "A creator list is created", group: "Creators & Lists", defaultOn: false, glyph: "📋" },
  { key: "list.add_creators", label: "Creators Added to List", description: "Creators are added to a list", group: "Creators & Lists", defaultOn: false, glyph: "📥" },
  { key: "negotiation.approve", label: "Offer Accepted", description: "A creator accepts an offer", group: "Creators & Lists", defaultOn: true, glyph: "✅" },
  { key: "negotiation.reject", label: "Offer Declined", description: "A creator declines an offer", group: "Creators & Lists", defaultOn: true, glyph: "❌" },

  // Financial — mirrors the reference's payment rows, all quiet by default.
  { key: "deposit.create", label: "New Payment", description: "A campaign deposit is recorded", group: "Financial", defaultOn: false, glyph: "💰" },
  { key: "payout.create", label: "New Payout", description: "A payout is created", group: "Financial", defaultOn: false, glyph: "💸" },
  { key: "payout.status_changed", label: "Payout Status Updated", description: "A payout moves between statuses", group: "Financial", defaultOn: false, glyph: "🔁" },
  { key: "payout_request.create", label: "Payout Request", description: "A creator requests a payout", group: "Financial", defaultOn: false, glyph: "🙋" },
];

const EVENT_MAP = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

export function isNotifiableAction(action: string): boolean {
  return EVENT_MAP.has(action);
}

export function notificationEvent(action: string): NotificationEventDef | undefined {
  return EVENT_MAP.get(action);
}
