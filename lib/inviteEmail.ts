import { BRAND } from "@/lib/brand";
import { sendEmail, type EmailKind, type SendResult } from "@/lib/email";
import type { UserRole } from "@/lib/rbac";

/**
 * The mail that carries a team invite.
 *
 * Until this existed the token was generated, stored, and shown to nobody: the
 * invited person received nothing at all and the row sat there until it
 * expired. The Team screen's "copy link" button was the whole delivery
 * mechanism, which meant every teammate anyone added had to be chased by hand
 * over Slack or WhatsApp.
 *
 * Both the create and the resend path go through here, so the wording, the URL
 * shape and the expiry line cannot drift apart between them.
 */

/** Plain-English role names. The enum leaks otherwise -- "You have been added
    as a MEMBER" reads like a database dump, not an invitation. */
const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: "an owner",
  ADMIN: "an admin",
  MANAGER: "a manager",
  MEMBER: "a member",
  VIEWER: "a viewer (read-only)",
};

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;
}

export async function sendInviteEmail(opts: {
  to: string;
  orgName: string;
  role: UserRole;
  token: string;
  origin: string;
  expiresAt: Date;
  /** Who clicked invite, when we know. Gives the recipient someone to reply to
      and makes an unexpected invitation answerable rather than suspicious. */
  invitedByEmail?: string | null;
  /* Carried through to EmailLog so a delivery question -- "did Sanskar ever get
     it?" -- is answered by the record rather than by asking Sanskar. Create and
     resend look identical in the mail itself, so the kind is what tells them
     apart afterwards. */
  kind?: EmailKind;
  orgId?: string | null;
  inviteId?: string | null;
}): Promise<SendResult> {
  const url = inviteUrl(opts.origin, opts.token);
  const roleLabel = ROLE_LABEL[opts.role] ?? `a ${String(opts.role).toLowerCase()}`;

  /* Date only, in UTC. An exact timestamp invites a timezone argument the
     recipient cannot win, and the window is a week -- a day's precision is the
     honest resolution. */
  const expires = opts.expiresAt.toISOString().slice(0, 10);

  return sendEmail({
    to: opts.to,
    subject: `You have been invited to ${opts.orgName} on ${BRAND.name}`,
    replyTo: opts.invitedByEmail ?? undefined,
    kind: opts.kind ?? "invite",
    orgId: opts.orgId ?? null,
    actorEmail: opts.invitedByEmail ?? null,
    entityId: opts.inviteId ?? null,
    text: [
      `You have been invited to join ${opts.orgName} on ${BRAND.name} as ${roleLabel}.`,
      "",
      "Open this link to set your name and password:",
      url,
      "",
      `The link expires on ${expires}. After that it stops working and somebody`,
      "at the organisation has to send a new one.",
      "",
      /* Say this plainly. The token is the only thing the accept endpoint
         checks -- it is not tied to the address we sent it to -- so treating it
         like a password is not paranoia, it is accurate. */
      "Treat this link like a password: anyone who opens it can join the",
      "organisation with the access above.",
      "",
      opts.invitedByEmail
        ? `If you were not expecting this, reply to ${opts.invitedByEmail} or ignore the email.`
        : "If you were not expecting this, ignore this email and the link will expire on its own.",
    ].join("\n"),
  });
}
