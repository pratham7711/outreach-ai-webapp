import { NOTIFICATION_EVENTS, notificationEvent } from "@/lib/notificationCatalog";

/**
 * The in-app notification feed — the top bar's bell.
 *
 * There is no Notification table and this pass does not add one. There does not
 * need to be: every notifiable thing already lands in AuditLog with the same
 * stable action string that lib/notifications.ts keys email and Slack fan-out
 * off. The bell is therefore a third reader of that one stream, orgId-scoped,
 * narrowed to the actions in NOTIFICATION_EVENTS — an action outside the
 * catalog (login, api_key.rotate, settings churn) is audit, not news.
 *
 * "Unread" is the one thing AuditLog cannot answer, because read state is
 * per-user and nothing persists it. The bell keeps a last-seen timestamp in the
 * browser instead and asks the server how many notifiable rows are newer than
 * it. That is honest about what it knows: it is per-device, and clearing site
 * data resets it. Persisting it properly is a schema change.
 *
 * One catalog entry cannot appear here: comment.create dispatches through
 * notifyAuditEvent directly from the campaign activity route and never writes
 * an AuditLog row, so the bell has nothing to read for it.
 */

/** How far back the feed looks. Bounded so a two-year-old org does not report
    40,000 unread on a browser that has never opened the bell. */
export const NOTIFICATION_LOOKBACK_DAYS = 30;

/** Newest N shown in the dropdown. The bell is a glance, not the audit log. */
export const NOTIFICATION_FEED_LIMIT = 8;

export const NOTIFIABLE_ACTIONS: string[] = NOTIFICATION_EVENTS.map((e) => e.key);

export type NotificationItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  /** ISO-8601. */
  createdAt: string;
};

/* Only entity types with a route reachable from the audit row's own id. A post,
   a NegotiationOffer, a CampaignDeposit and a PayoutRequest all live on a page
   nested under a campaign the row does not name, so those are deliberately
   unlinked rather than pointed somewhere approximate. */
const DETAIL_HREF: Record<string, (id: string) => string> = {
  campaign: (id) => `/campaigns/${id}`,
  creator: (id) => `/creators/${id}`,
  client: (id) => `/clients/${id}`,
  creator_list: (id) => `/lists/${id}`,
  song: (id) => `/songs/${id}`,
};

const INDEX_HREF: Record<string, string> = {
  activation: "/activations",
  payout: "/payouts",
};

export function notificationHref(item: Pick<NotificationItem, "entityType" | "entityId">): string | null {
  const detail = DETAIL_HREF[item.entityType];
  if (detail && item.entityId) return detail(item.entityId);
  return INDEX_HREF[item.entityType] ?? null;
}

/**
 * The Dropdown's item label is a plain string, so the whole line is built here:
 * catalog label, then what it happened to. An audit row written before
 * entityLabel was populated has no name to show — the event label alone is
 * still true, which is more than a dangling em dash would be.
 */
export function describeNotification(
  item: Pick<NotificationItem, "action" | "entityType" | "entityId" | "entityLabel">
): { glyph: string; title: string; href: string | null } {
  const def = notificationEvent(item.action);
  const title = def?.label ?? item.action;
  const label = item.entityLabel?.trim();
  return {
    glyph: def?.glyph ?? "•",
    title: label ? `${title} — ${label}` : title,
    href: notificationHref(item),
  };
}

/** Badges cap rather than grow: a three-digit count in a 34px control wraps. */
export function formatUnreadBadge(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}
