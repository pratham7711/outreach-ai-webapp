"use client";

import { useId } from "react";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { SourceLabel, formatCount, formatDay, platformLabel } from "@/components/portal/app/ui";
import { MetricCells, NUM, Panel, Thumb, type Cell } from "@/components/insights/parts";
import { PLATFORM_HUE } from "@/components/portal/stats/AccountChrome";

export type CampaignPost = {
  id: string;
  platform: string;
  postUrl: string;
  caption: string | null;
  thumbnailUrl?: string | null;
  postedAt: string;
  campaignTitle: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  saves: number | null;
};

const hue = (platform: string) => PLATFORM_HUE[platform as keyof typeof PLATFORM_HUE] ?? "var(--cc-text-muted)";

function PostCell({ p }: { p: CampaignPost }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <Thumb
        src={p.thumbnailUrl ?? null}
        width={40}
        height={50}
        fallback={
          <span style={{ fontSize: 16, display: "inline-flex", color: hue(p.platform) }}>
            <PlatformGlyph platform={p.platform} size="1em" />
          </span>
        }
      />
      <div style={{ minWidth: 0 }}>
        <a
          href={p.postUrl}
          target="_blank"
          rel="noreferrer"
          className="hover:underline underline-offset-2"
          style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--cc-text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {p.campaignTitle}
        </a>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>
          <span aria-hidden="true" style={{ display: "inline-flex", color: hue(p.platform), fontSize: 13 }}>
            <PlatformGlyph platform={p.platform} size="1em" />
          </span>
          {platformLabel(p.platform)} · {formatDay(p.postedAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * The posts the creator made for campaigns, as the agency's tracker read
 * them: a table on a desktop, a list on a phone. A column is drawn only when
 * at least one post has a figure for it. Reach and saves come from Instagram
 * insights, so they are left blank (not 0) on the other platforms' posts.
 */
export default function CampaignPosts({ posts }: { posts: CampaignPost[] }) {
  const id = useId();
  const instagram = posts.some((p) => p.platform === "INSTAGRAM");
  const campaigns = new Set(posts.map((p) => p.campaignTitle)).size;
  const measured = posts.filter((p) => typeof p.views === "number");
  const totalViews = measured.reduce((a, p) => a + (p.views as number), 0);
  const columns = (
    [
      { key: "views", label: "Views" },
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Comments" },
      { key: "reach", label: "Reach", igOnly: true },
      { key: "saves", label: "Saves", igOnly: true },
    ] as Array<{ key: "views" | "likes" | "comments" | "reach" | "saves"; label: string; igOnly?: boolean }>
  ).filter((c) => posts.some((p) => typeof p[c.key] === "number"));
  const insightsColumns = columns.some((c) => c.igOnly);
  const cells = (p: CampaignPost): Cell[] =>
    columns.map((c) => ({ label: c.label, value: p[c.key] as number | null, blank: c.igOnly && p.platform !== "INSTAGRAM" }));
  const th = { fontSize: 12, fontWeight: 500, color: "var(--cc-text-muted)", padding: "0 0 10px 20px", textAlign: "right", whiteSpace: "nowrap" } as const;

  return (
    <Panel labelledBy={id}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px", flexWrap: "wrap", marginBottom: 14 }}>
        <h2 id={id} style={{ fontSize: 17, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
          Your campaign posts
        </h2>
        <span style={{ ...NUM, fontSize: 13, color: "var(--cc-text-muted)" }}>
          {posts.length} {posts.length === 1 ? "post" : "posts"} across {campaigns} {campaigns === 1 ? "campaign" : "campaigns"}
          {measured.length > 0 && (
            <>
              {" "}· <strong style={{ color: "var(--cc-text)", fontWeight: 700 }}>{formatCount(totalViews)}</strong> views in all
            </>
          )}
        </span>
      </div>

      <table className="hidden md:table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...th, textAlign: "left", paddingLeft: 0 }}>
              Post
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={th}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} style={{ borderTop: "1px solid var(--cc-border)" }}>
              <td style={{ padding: "10px 16px 10px 0", maxWidth: 0, width: "100%" }}>
                <PostCell p={p} />
              </td>
              {columns.map((c) => {
                const blank = c.igOnly && p.platform !== "INSTAGRAM";
                return (
                  <td key={c.key} style={{ ...NUM, padding: "10px 0 10px 20px", textAlign: "right", fontSize: 14, fontWeight: 700, color: "var(--cc-text)", whiteSpace: "nowrap" }}>
                    {blank ? "" : formatCount(p[c.key] as number | null)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="md:hidden" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {posts.map((p) => (
          <li key={p.id} style={{ padding: "12px 0", borderTop: "1px solid var(--cc-border)", display: "flex", flexDirection: "column", gap: 10 }}>
            <PostCell p={p} />
            <MetricCells cells={cells(p)} />
          </li>
        ))}
      </ul>

      <SourceLabel>
        From each post as we read it for the campaign
        {instagram && insightsColumns && <> · reach and saves from Instagram insights on your campaign posts</>}
      </SourceLabel>
    </Panel>
  );
}
