import { campaignInvitePath } from "@/lib/portal/invitePath";

/**
 * Where a creator lands after logging in or signing up, and the errand that
 * brought them to the auth page in the first place. Shared by
 * /portal/login and /portal/register so the two can never disagree.
 *
 * Three errands arrive as query parameters, all pinned in places we do not
 * control (copied links, emails already sent, the marketplace CTA):
 *
 *  - `invitation=<token>`: an agency's invite link (/invite/<token>). Accepting
 *    links the roster row to this login and lands on the campaign. If it is
 *    refused (closed, accepted from another login) the creator goes back to the
 *    landing page, which shows the invite's state and offers Accept again.
 *  - `join=<slug>` with optional `invite=<code>`: the open marketplace and the
 *    older join-with-code links (/portal/register?join=&invite=). Joining is
 *    immediate; a refusal is shown on the campaign page.
 *  - `connect=<token>`: "Create a login to see your campaigns" on an agency's
 *    connect link (/connect/<token>). Names this login on the link's roster
 *    row and lands on My accounts, which then lists what was just connected.
 *  - none: Home.
 *
 * Client-side only (it calls fetch on the creator's own cookie).
 */
export type AuthErrand = {
  invitation: string | null;
  join: string | null;
  invite: string | null;
  connect: string | null;
};

export function readAuthErrand(params: { get(name: string): string | null }): AuthErrand {
  return {
    invitation: params.get("invitation"),
    join: params.get("join"),
    invite: params.get("invite"),
    connect: params.get("connect"),
  };
}

/** The same errand as a query string, for the link to the other auth page. */
export function errandQuery(errand: AuthErrand): string {
  const q = new URLSearchParams();
  if (errand.invitation) q.set("invitation", errand.invitation);
  if (errand.join) {
    q.set("join", errand.join);
    if (errand.invite) q.set("invite", errand.invite);
  }
  if (errand.connect) q.set("connect", errand.connect);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function landingAfterAuth(errand: AuthErrand, fallback: string): Promise<string> {
  if (errand.invitation) {
    try {
      const res = await fetch(`/api/portal/invites/${encodeURIComponent(errand.invitation)}/accept`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.campaignPath === "string") return `${data.campaignPath}?accepted=1`;
    } catch {
      /* Fall through to the landing page, which offers Accept again. */
    }
    return campaignInvitePath(errand.invitation);
  }

  if (errand.join) {
    const slug = errand.join;
    const base = `/portal/campaigns/${encodeURIComponent(slug)}`;
    try {
      const res = await fetch("/api/portal/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...(errand.invite ? { inviteCode: errand.invite } : {}) }),
      });
      if (res.ok) return `${base}?joined=1`;
      const data = await res.json().catch(() => ({}));
      return `${base}?joinError=${encodeURIComponent(data.error ?? "Could not join")}`;
    } catch {
      return `${base}?joinError=${encodeURIComponent("Network error")}`;
    }
  }

  if (errand.connect) {
    try {
      const res = await fetch("/api/portal/connect-link/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: errand.connect }),
      });
      if (res.ok) return "/portal/accounts";
    } catch {
      /* Fall through: the login works, the link can be opened again. */
    }
  }

  return fallback;
}
