"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import CreatorAvatar, { avatarRequestPx } from "@/components/creators/CreatorAvatar";
import PlatformChips from "@/components/creators/PlatformChips";
import { formatFull, formatFullCurrency, platformLabel } from "@/lib/format";
import type { ListShareFields, SharedCreator } from "@/lib/lists/listShare";
import type { SharedReview, SharedVerdict } from "@/lib/lists/listReview";
import ShareVerdict, { type VerdictResult } from "./ShareVerdict";

const PAGE = 60;
const FOLLOWER_STEPS = [
  { value: 0, label: "Any size" },
  { value: 10_000, label: "10K+ followers" },
  { value: 100_000, label: "100K+ followers" },
  { value: 1_000_000, label: "1M+ followers" },
];

const countries = (s: string | null) => (s ?? "").split(",").map((c) => c.trim()).filter(Boolean);

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * A brand's view of one shared list. Everything here was already cut down to
 * what the link may show before it left the server; this only filters it.
 */
export default function SharedListView({
  token,
  name,
  description,
  orgName,
  fields,
  creators,
  review = null,
  poweredBy,
}: {
  token: string;
  name: string;
  description: string | null;
  orgName: string | null;
  fields: ListShareFields;
  creators: SharedCreator[];
  /** Present once the list-approval tables exist; null renders the plain read-only page. */
  review?: SharedReview | null;
  poweredBy: string;
}) {
  const [verdicts, setVerdicts] = useState<Record<string, SharedVerdict>>(review?.verdicts ?? {});
  const [counts, setCounts] = useState(review?.counts ?? null);
  const approvals = Boolean(review?.settings.approvals);
  const onSaved = (creatorId: string) => (result: VerdictResult) => {
    setVerdicts((v) => ({ ...v, [creatorId]: result.verdict }));
    setCounts(result.list.counts);
  };
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [tag, setTag] = useState("");
  const [minFollowers, setMinFollowers] = useState(0);
  const [audience, setAudience] = useState("");
  const [shown, setShown] = useState(PAGE);

  const platforms = useMemo(() => uniqueSorted(creators.flatMap((c) => c.accounts.map((a) => a.platform))), [creators]);
  const tags = useMemo(() => uniqueSorted(creators.flatMap((c) => c.tags)), [creators]);
  const audiences = useMemo(() => uniqueSorted(creators.flatMap((c) => countries(c.audienceCountry))), [creators]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return creators.filter((c) => {
      if (needle && !`${c.name} ${c.handle} ${c.accounts.map((a) => a.handle).join(" ")}`.toLowerCase().includes(needle)) return false;
      if (platform && !c.accounts.some((a) => a.platform === platform)) return false;
      if (tag && !c.tags.includes(tag)) return false;
      if (minFollowers && !c.accounts.some((a) => (a.followersCount ?? 0) >= minFollowers) && (c.followersCount ?? 0) < minFollowers) return false;
      if (audience && !countries(c.audienceCountry).includes(audience)) return false;
      return true;
    });
  }, [creators, q, platform, tag, minFollowers, audience]);

  const filtering = Boolean(q || platform || tag || minFollowers || audience);
  const reset = () => {
    setQ("");
    setPlatform("");
    setTag("");
    setMinFollowers(0);
    setAudience("");
  };
  const avatarSrc = (id: string) => `/api/l/${encodeURIComponent(token)}/avatar/${encodeURIComponent(id)}?w=${avatarRequestPx("lg")}`;

  return (
    <main className="cc-sl">
      <header className="cc-sl-head">
        {orgName && <p className="cc-sl-org">{orgName}</p>}
        <h1 className="cc-sl-title">{name}</h1>
        {description && <p className="cc-sl-desc">{description}</p>}
        <p className="cc-sl-count">
          {formatFull(creators.length)} creator{creators.length === 1 ? "" : "s"}
        </p>
        {review && (approvals || review.rateTotal != null) && (
          <p className="cc-sl-review" aria-live="polite">
            {approvals && counts && (
              <span>
                <strong>{formatFull(counts.total - counts.pending)}</strong> of {formatFull(counts.total)} reviewed ·{" "}
                {formatFull(counts.approved)} approved · {formatFull(counts.rejected)} declined
              </span>
            )}
            {review.rateTotal != null && (
              <span>
                List total <strong>{formatFullCurrency(review.rateTotal)}</strong>
              </span>
            )}
          </p>
        )}
      </header>

      {review?.closed && approvals && (
        <p className="cc-sl-closed">This list is closed for review. Your decisions are saved, but can no longer be changed.</p>
      )}

      {creators.length > 0 && (
        <div className="cc-sl-filters" role="search">
          <label className="cc-sl-search">
            <Search size={16} aria-hidden />
            <input
              className="cc-field"
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Search by name or handle"
              aria-label="Search creators"
            />
          </label>
          {platforms.length > 1 && (
            <select className="cc-field" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
              <option value="">All platforms</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>
          )}
          {fields.tags && tags.length > 0 && (
            <select className="cc-field" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {fields.stats && (
            <select className="cc-field" value={minFollowers} onChange={(e) => setMinFollowers(Number(e.target.value))} aria-label="Followers">
              {FOLLOWER_STEPS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          {fields.audienceCountry && audiences.length > 0 && (
            <select className="cc-field" value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Audience country">
              <option value="">Any audience</option>
              {audiences.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {filtering && (
        <p className="cc-sl-status" aria-live="polite">
          {formatFull(matches.length)} of {formatFull(creators.length)} match
          <button type="button" onClick={reset}>
            Clear filters
          </button>
        </p>
      )}

      {creators.length === 0 ? (
        <p className="cc-sl-empty">There are no creators on this list yet.</p>
      ) : matches.length === 0 ? (
        <p className="cc-sl-empty">No creators match these filters.</p>
      ) : (
        <ul className="cc-sl-grid">
          {matches.slice(0, shown).map((c) => (
            <li key={c.id} className="cc-sl-card">
              <div className="cc-sl-card-head">
                <CreatorAvatar id={c.id} name={c.name} size="lg" src={avatarSrc(c.id)} />
                <div className="cc-sl-card-name">
                  <p title={c.name}>{c.name}</p>
                  <p>@{c.handle}</p>
                </div>
              </div>
              <PlatformChips links={c.accounts} />
              {c.tags.length > 0 && (
                <span className="cc-roster-tags">
                  {c.tags.map((t) => (
                    <span key={t} className="cc-roster-tag">
                      {t}
                    </span>
                  ))}
                </span>
              )}
              {(fields.stats || c.audienceCountry || c.rate || review?.settings.engagementRate) && (
                <dl className="cc-sl-facts">
                  {fields.stats && (
                    <div>
                      <dt>Followers</dt>
                      <dd>{c.followersCount ? formatFull(c.followersCount) : "—"}</dd>
                    </div>
                  )}
                  {fields.stats && (
                    <div>
                      <dt>Avg. views</dt>
                      <dd>{c.averageViews ? formatFull(c.averageViews) : "—"}</dd>
                    </div>
                  )}
                  {c.audienceCountry && (
                    <div className="cc-sl-fact-wide">
                      <dt>Audience</dt>
                      <dd>{c.audienceCountry}</dd>
                    </div>
                  )}
                  {review?.settings.engagementRate && (
                    <div>
                      <dt>Eng. rate</dt>
                      <dd>{verdicts[c.id]?.engagementRate != null ? `${verdicts[c.id].engagementRate!.toFixed(2)}%` : "—"}</dd>
                    </div>
                  )}
                  {c.rate ? (
                    <div>
                      <dt>Price per video</dt>
                      <dd>{formatFullCurrency(c.rate)}</dd>
                    </div>
                  ) : null}
                </dl>
              )}
              {approvals && verdicts[c.id] && (
                <ShareVerdict
                  token={token}
                  creatorId={c.id}
                  creatorName={c.name}
                  verdict={verdicts[c.id]}
                  feedback={Boolean(review?.settings.feedback)}
                  closed={Boolean(review?.closed)}
                  onSaved={onSaved(c.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {matches.length > shown && (
        <div className="cc-sl-more">
          <button type="button" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({formatFull(matches.length - shown)} left)
          </button>
        </div>
      )}

      <footer className="cc-sl-footer">{poweredBy}</footer>
    </main>
  );
}
