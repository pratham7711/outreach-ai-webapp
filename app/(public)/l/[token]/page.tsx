import { cache } from "react";
import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { POWERED_BY } from "@/lib/brand";
import { loadListShare, sharedListCreators } from "@/lib/lists/listShare";
import SharedListView from "./SharedListView";

/** generateMetadata and the page both need the share; cache() makes it one query per request. */
const loadShare = cache((token: string) => loadListShare(token));

/* Unlisted on purpose: the link is handed to someone, never found. */
const robots = { index: false, follow: false };

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const share = await loadShare(token);
  if (!share) return { title: "List unavailable", robots };
  return {
    title: share.orgName ? `${share.name} | ${share.orgName}` : share.name,
    description: `A creator list${share.orgName ? ` from ${share.orgName}` : ""}.`,
    robots,
  };
}

function NoLongerShared() {
  return (
    <main className="cc-sl cc-sl-gone">
      <div className="cc-sl-gone-card">
        <Link2 size={36} aria-hidden className="cc-sl-gone-icon" />
        <h1>This list is no longer shared</h1>
        <p>The link may have been turned off, or the address is incomplete. Ask whoever sent it for a new one.</p>
      </div>
      <footer className="cc-sl-footer">{POWERED_BY}</footer>
    </main>
  );
}

export default async function SharedListPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await loadShare(token);
  if (!share) return <NoLongerShared />;

  const creators = await sharedListCreators(share);
  return (
    <SharedListView
      token={token}
      name={share.name}
      description={share.description}
      orgName={share.orgName}
      fields={share.fields}
      creators={creators}
      poweredBy={POWERED_BY}
    />
  );
}
