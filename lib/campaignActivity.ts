import { db } from "./db";
import { campaignStatusLabel } from "./statusColors";

/**
 * The campaign activity feed's event vocabulary, phrased to match CreatorCore.
 *
 * The glyphs and wording are a parity requirement, not decoration -- see
 * docs/CREATORCORE_PARITY_PRD.md §4.1, where they were captured verbatim from
 * the reference. Keeping them in one module means the phrasing is testable and
 * the API returns finished strings rather than making each client re-derive them.
 *
 * Two of the six have no source yet: nothing in the product bulk-adds posts from
 * a user action (the only bulk path is the admin importer, which has no campaign
 * context), and there is no post delete route at all. Their renderers exist so
 * the vocabulary is complete the moment a source appears, and so a stray row of
 * either kind is displayed rather than silently dropped.
 */
export const FEED_ACTIONS = [
  "activation.create",
  "activation.update",
  "post.create",
  "post.bulk_create",
  "post.delete",
  "campaign.update",
] as const;

export type ActivityEvent = {
  id: string;
  glyph: string;
  text: string;
  createdAt: string;
  kind: "event" | "comment";
};

type AuditRow = {
  id: string;
  action: string;
  userId: string | null;
  actorEmail: string | null;
  entityId: string | null;
  entityLabel: string | null;
  metadata: unknown;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

type CommentRow = {
  id: string;
  content: string;
  createdAt: Date;
  user: { id: string; name: string | null; email: string | null } | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** AWAITING_DRAFT -> Awaiting Draft. The reference shows human labels. */
export function humanStatus(raw: unknown): string {
  const s = str(raw);
  if (!s) return "Unknown";
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** "Maria Santos", else the email's local part, else "Someone". */
function actorName(row: AuditRow, users: Map<string, string>): string {
  if (row.userId) {
    const name = users.get(row.userId);
    if (name) return name;
  }
  if (row.actorEmail) return row.actorEmail.split("@")[0];
  return "Someone";
}

function creatorPhrase(id: string | null, creators: Map<string, { name: string; handle: string | null }>): string {
  if (!id) return "A creator";
  const c = creators.get(id);
  if (!c) return "A creator";
  return c.handle ? `${c.name} (@${c.handle.replace(/^@/, "")})` : c.name;
}

/**
 * Turns audit rows and comments into the rendered feed, newest first.
 *
 * Resolves creator and user names in two queries rather than per row: activation
 * events carry only ids, and the reference's phrasing needs the display name.
 */
export async function buildActivityFeed(
  logs: AuditRow[],
  comments: CommentRow[]
): Promise<ActivityEvent[]> {
  const creatorIds = new Set<string>();
  const userIds = new Set<string>();

  for (const row of logs) {
    if (row.userId) userIds.add(row.userId);
    const after = asRecord(row.after);
    const meta = asRecord(row.metadata);
    const creatorId = str(after.creatorId) ?? str(meta.creatorId);
    if (creatorId) creatorIds.add(creatorId);
  }
  for (const c of comments) if (c.user?.id) userIds.add(c.user.id);

  const [creatorRows, userRows] = await Promise.all([
    creatorIds.size
      ? db.creator.findMany({
          where: { id: { in: [...creatorIds] } },
          select: { id: true, name: true, handle: true },
        })
      : Promise.resolve([]),
    userIds.size
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);

  const creators = new Map(creatorRows.map((c) => [c.id, { name: c.name, handle: c.handle }]));
  const users = new Map(
    userRows.map((u) => [u.id, u.name || (u.email ? u.email.split("@")[0] : "")])
  );

  const events: ActivityEvent[] = [];

  for (const row of logs) {
    const who = actorName(row, users);
    const before = asRecord(row.before);
    const after = asRecord(row.after);
    const meta = asRecord(row.metadata);
    const creatorId = str(after.creatorId) ?? str(meta.creatorId);
    const base = { id: row.id, createdAt: row.createdAt.toISOString(), kind: "event" as const };

    switch (row.action) {
      case "activation.create":
        events.push({
          ...base,
          glyph: "➕",
          text: `${creatorPhrase(creatorId, creators)} has been added to the campaign by ${who}`,
        });
        break;

      case "activation.update": {
        // Only a status transition is an activity event; notes and URL edits are
        // audit detail the reference does not surface here.
        if (!after.status || before.status === after.status) break;
        events.push({
          ...base,
          glyph: "🌀",
          text: `${creatorPhrase(creatorId, creators)} status has been changed to ${humanStatus(after.status)} by ${who}`,
        });
        break;
      }

      case "post.create":
        events.push({ ...base, glyph: "🤳", text: `A new post has been added by ${who}` });
        break;

      case "post.bulk_create": {
        const n = typeof meta.count === "number" ? meta.count : null;
        events.push({
          ...base,
          glyph: "📦",
          text: n === null ? `Posts were added by ${who}` : `${n} posts were added by ${who}`,
        });
        break;
      }

      case "post.delete":
        events.push({ ...base, glyph: "🗑️", text: `A post has been deleted by ${who}` });
        break;

      case "campaign.update": {
        if (!after.status || before.status === after.status) break;
        events.push({
          ...base,
          glyph: "💡",
          /* campaignStatusLabel, not humanStatus: title-casing the enum gives
             "In Progress", and the status control on the campaign this feed is
             attached to says "In-Progress". The feed named a status the page
             beside it did not have. Activation statuses above still go through
             humanStatus -- they have no curated map, and title-casing
             AWAITING_DRAFT is exactly right. */
          text: `Campaign status has been changed to ${campaignStatusLabel(after.status as string)} by ${who}`,
        });
        break;
      }
    }
  }

  for (const c of comments) {
    const who = c.user?.name || (c.user?.email ? c.user.email.split("@")[0] : "Someone");
    events.push({
      id: c.id,
      glyph: "💬",
      text: `${who}: ${c.content}`,
      createdAt: c.createdAt.toISOString(),
      kind: "comment",
    });
  }

  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
