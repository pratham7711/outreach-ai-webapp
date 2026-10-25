"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCount, formatDay } from "@/components/portal/app/ui";
import type { DiscoveryProfileView } from "@/lib/platforms/instagramDiscoveryProfile";

/**
 * The creator's public Instagram profile and recent posts, read live through
 * Business Discovery on behalf of the agency's own Instagram account
 * (/api/creators/[id]/instagram-discovery). Renders nothing for a creator with
 * no Instagram handle.
 */

type Body = { profile: DiscoveryProfileView; via: { username: string }; readAt: string; stored: false };

type State =
  | { status: "loading" }
  | { status: "read"; body: Body }
  | { status: "failed"; error: string | null; reason: string };

const muted = { fontSize: 12, color: "var(--cc-text-muted)", margin: 0 } as const;

function Count({ label, value }: { label: string; value: number | undefined }) {
  return (
    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
      <strong style={{ color: "var(--cc-text)" }}>{formatCount(value)}</strong> {label}
    </span>
  );
}

export default function InstagramDiscoveryPanel({ creatorId }: { creatorId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    const failed = "We couldn't read this public profile. Reload to try again.";
    fetch(`/api/creators/${encodeURIComponent(creatorId)}/instagram-discovery`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok && body?.profile) setState({ status: "read", body: body as Body });
        else setState({ status: "failed", error: body?.error ?? null, reason: body?.reason ?? failed });
      })
      .catch(() => live && setState({ status: "failed", error: null, reason: failed }));
    return () => {
      live = false;
    };
  }, [creatorId]);

  if (state.status === "failed" && state.error === "no_instagram_handle") return null;

  return (
    <section
      aria-labelledby="ig-discovery-title"
      style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24, marginTop: 16 }}
    >
      <h2 id="ig-discovery-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
        Public Instagram profile
      </h2>
      {state.status === "loading" && <p style={{ ...muted, marginTop: 8 }}>Reading the public profile from Instagram…</p>}
      {state.status === "failed" && (
        <p role="alert" style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "8px 0 0" }}>
          {state.reason}
          {state.error === "no_agency_account" || state.error === "agency_reauthorize" ? (
            <>
              {" "}
              <Link href="/settings/integrations" style={{ color: "var(--cc-primary)", fontWeight: 600 }}>
                Open Integrations
              </Link>
            </>
          ) : null}
        </p>
      )}
      {state.status === "read" && <Profile body={state.body} />}
    </section>
  );
}

function Profile({ body }: { body: Body }) {
  const { profile, via } = body;
  return (
    <div>
      <p style={{ ...muted, marginTop: 4 }}>
        Read just now with Business Discovery, through your Instagram Business account (@{via.username}). Not saved.
      </p>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 14, minWidth: 0 }}>
        {profile.profilePictureUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={profile.profilePictureUrl}
            alt={`@${profile.username}`}
            width={56}
            height={56}
            style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "var(--cc-border)" }}
          />
        ) : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", overflowWrap: "anywhere" }}>{profile.name ?? `@${profile.username}`}</div>
          <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            <a href={`https://www.instagram.com/${profile.username}/`} target="_blank" rel="noreferrer" style={{ color: "var(--cc-primary)", textDecoration: "none", fontWeight: 600 }}>
              @{profile.username}
            </a>
            {profile.website ? (
              <>
                {" · "}
                <span style={{ overflowWrap: "anywhere" }}>{profile.website}</span>
              </>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
            <Count label="followers" value={profile.followers} />
            <Count label="following" value={profile.following} />
            <Count label="posts" value={profile.posts} />
          </div>
          {profile.biography && (
            <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{profile.biography}</p>
          )}
        </div>
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "18px 0 8px" }}>Recent posts</h3>
      {profile.media.length === 0 ? (
        <p style={muted}>Instagram returned no public posts for this account.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {profile.media.map((m) => (
            <li key={m.id} style={{ minWidth: 0 }}>
              <a href={m.permalink ?? undefined} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "block" }}>
                {m.thumbnailUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={m.thumbnailUrl}
                    alt={m.caption ? m.caption.slice(0, 80) : "Instagram post"}
                    style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 8, background: "var(--cc-border)", display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 8, background: "var(--cc-border)" }} />
                )}
              </a>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 6 }}>{formatDay(m.postedAt)}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text)", marginTop: 2 }}>
                {[
                  m.views !== undefined ? `${formatCount(m.views)} views` : null,
                  m.likes !== undefined ? `${formatCount(m.likes)} likes` : "likes hidden",
                  m.comments !== undefined ? `${formatCount(m.comments)} comments` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {m.caption && (
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {m.caption}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
