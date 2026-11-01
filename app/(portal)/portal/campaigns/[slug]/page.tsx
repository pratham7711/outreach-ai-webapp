"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, CircleHelp, Clock, Download, ExternalLink, X } from "lucide-react";
import { Input } from "@pratham7711/ui";
import { Button, Dropdown } from "@/components/ds";
import { detectPlatform, MEDIA_TYPES } from "@/lib/platforms/postUrl";
import { SHOW_MONEY } from "@/lib/moneyUi";
import type { CampaignDate } from "@/lib/portal/campaignDates";
import { splitLinks } from "@/lib/portal/postLinks";
import type { RuleCheck } from "@/lib/portal/submissionRules";
import {
  Banner,
  Card,
  EmptyState,
  Screen,
  SectionTitle,
  SkeletonBlock,
  StatusPill,
  formatCount,
  formatDay,
  platformLabel,
  relativeDay,
  type Tone,
} from "@/components/portal/app/ui";

type CampaignDetail = {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  joinable: boolean;
  acceptsPosts: boolean;
  marketplace: boolean;
  currency: string;
  brief: string | null;
  guidelines: string | null;
  requirements: string | null;
  contentAssetsUrl: string | null;
  rates: Record<string, number>;
  submissionDeadline: string | null;
  deadlinePassed: boolean;
  dates: CampaignDate[];
  orgName: string;
  /** A launch date still ahead: posts open then. */
  scheduledUntil?: string | null;
  checklist?: { dos: string[]; donts: string[]; examples: string[] };
  /** The agency's submission rules, checked for this creator before submitting. */
  ruleChecks?: RuleCheck[];
  ruleChecksPlatform?: string | null;
  /** Whether the agency asks for boost codes on this campaign. */
  boostCodes?: boolean;
};

type Submission = {
  id: string;
  postUrl: string;
  platform: string;
  status: string;
  viewsCount: number;
  views: number | null;
  caption: string | null;
  rejectionReason: string | null;
  createdAt: string;
  lastSyncedAt: string | null;
  earnedMinor: number;
  boostCode?: string | null;
  boostCodeExpiresAt?: string | null;
};

type Draft = {
  status: string;
  draftUrl: string | null;
  draftCaption: string | null;
  draftMediaType: string | null;
  draftSubmittedAt: string | null;
  feedbackNotes: string | null;
};

const SUBMISSION_STATE: Record<string, { tone: Tone; label: string }> = {
  PENDING_REVIEW: { tone: "warning", label: "In review" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "danger", label: "Not accepted" },
};

const DRAFT_STATE: Record<string, { tone: Tone; label: string }> = {
  AWAITING_DRAFT: { tone: "neutral", label: "Optional" },
  DRAFT_SUBMITTED: { tone: "warning", label: "In review" },
  AWAITING_APPROVAL: { tone: "warning", label: "In review" },
  APPROVED: { tone: "success", label: "Approved" },
  POSTING: { tone: "success", label: "Approved" },
  POSTED: { tone: "success", label: "Approved" },
  COMPLETE: { tone: "success", label: "Approved" },
  DECLINED: { tone: "danger", label: "Changes requested" },
};

const CAN_SUBMIT_DRAFT = ["AWAITING_DRAFT", "DECLINED", "DRAFT_SUBMITTED"];

/** At most this many links per paste; the route reads each one live. */
const MAX_LINKS = 20;

type Outcome = "added" | "already" | "rejected" | "failed";

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

/** `now` is when the campaign was loaded, so the render itself stays pure. */
function DatesCard({ dates, now }: { dates: CampaignDate[]; now: number }) {
  return (
    <Card>
      <SectionTitle>Dates</SectionTitle>
      {dates.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>
          The agency hasn&apos;t set any dates yet. They&apos;ll show here when they do.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {dates.map((d) => {
            const past = new Date(d.at).getTime() < now - 86_400_000;
            return (
              <li key={`${d.kind}-${d.at}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                <span style={{ color: past ? "var(--cc-text-muted)" : "var(--cc-text)", fontWeight: d.kind === "post_due" ? 600 : 400 }}>
                  {d.label}
                </span>
                <span style={{ color: "var(--cc-text-muted)", whiteSpace: "nowrap" }}>
                  {formatDay(d.at)} · {relativeDay(d.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function BriefCard({ detail }: { detail: CampaignDetail }) {
  const blocks = [
    ["Brief", detail.brief],
    ["Guidelines", detail.guidelines],
    ["Requirements", detail.requirements],
  ].filter((b): b is [string, string] => !!b[1]);
  const rates = Object.entries(detail.rates ?? {});
  const checklist = detail.checklist ?? { dos: [], donts: [], examples: [] };
  const hasChecklist = checklist.dos.length + checklist.donts.length + checklist.examples.length > 0;
  if (blocks.length === 0 && !hasChecklist && !detail.contentAssetsUrl && !(SHOW_MONEY && rates.length > 0)) return null;
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {blocks.map(([title, text]) => (
          <div key={title}>
            <SectionTitle>{title}</SectionTitle>
            <p style={{ fontSize: 14, color: "var(--cc-text)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{text}</p>
          </div>
        ))}
        {hasChecklist && <Checklist {...checklist} />}
        {/* Marketplace rates are money, and money is off in the creator app
            (lib/moneyUi.ts). Hidden, never cleared. */}
        {SHOW_MONEY && rates.length > 0 && (
          <div>
            <SectionTitle>Rates per 1,000 views</SectionTitle>
            <p style={{ fontSize: 14, color: "var(--cc-text)", margin: 0 }}>
              {rates.map(([p, minor]) => `${platformLabel(p)} ${money(minor, detail.currency)}`).join(" · ")}
            </p>
          </div>
        )}
        {detail.contentAssetsUrl && (
          <a
            href={detail.contentAssetsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rsp-touch"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--cc-primary)", textDecoration: "none" }}
          >
            <Download size={15} aria-hidden="true" /> Campaign assets
          </a>
        )}
      </div>
    </Card>
  );
}

const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 };
const rowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: "var(--cc-text)", lineHeight: 1.5 };
const iconStyle = (color: string): React.CSSProperties => ({ color, flexShrink: 0, marginTop: 3 });

/** The agency's do's and don'ts, and posts they point to as examples. */
function Checklist({ dos, donts, examples }: { dos: string[]; donts: string[]; examples: string[] }) {
  return (
    <div>
      <SectionTitle>Checklist</SectionTitle>
      {dos.length + donts.length > 0 && (
        <ul style={listStyle}>
          {dos.map((d) => (
            <li key={`do-${d}`} style={rowStyle}>
              <Check size={16} aria-label="Do" style={iconStyle("var(--cc-success)")} /> {d}
            </li>
          ))}
          {donts.map((d) => (
            <li key={`dont-${d}`} style={rowStyle}>
              <X size={16} aria-label="Don't" style={iconStyle("var(--cc-danger)")} /> {d}
            </li>
          ))}
        </ul>
      )}
      {examples.length > 0 && (
        <div style={{ marginTop: dos.length + donts.length > 0 ? 12 : 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 6 }}>Example posts</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {examples.map((url, i) => {
              const d = detectPlatform(url);
              return (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rsp-touch"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--cc-primary)", textDecoration: "none" }}
                >
                  {d ? `${platformLabel(d.platform)} example ${i + 1}` : `Example ${i + 1}`} <ExternalLink size={13} aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const RULE_ICON: Record<RuleCheck["state"], { Icon: typeof Check; color: string; label: string }> = {
  pass: { Icon: Check, color: "var(--cc-success)", label: "Met" },
  fail: { Icon: X, color: "var(--cc-danger)", label: "Not met" },
  unknown: { Icon: CircleHelp, color: "var(--cc-text-muted)", label: "Not checked" },
  pending: { Icon: Clock, color: "var(--cc-text-muted)", label: "Checked when you submit" },
};

/** The submission rules, each with what we measured against it. */
function RuleList({ checks }: { checks: RuleCheck[] }) {
  return (
    <div style={{ margin: "0 0 14px" }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>Rules for this campaign</span>
      <ul style={listStyle} data-testid="portal-rule-checks">
        {checks.map((c) => {
          const { Icon, color, label } = RULE_ICON[c.state];
          return (
            <li key={c.key} style={rowStyle} data-state={c.state}>
              <Icon size={16} aria-label={label} style={iconStyle(color)} />
              <span style={{ minWidth: 0 }}>
                {c.label}
                <span style={{ display: "block", fontSize: 13, color: "var(--cc-text-muted)" }}>{c.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  fontSize: 16,
  color: "var(--cc-text)",
  background: "var(--cc-card)",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const fieldLabel: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 };

/** A boost code and its expiry, as two fields. Expiry is a calendar day. */
function BoostFields({
  idPrefix,
  code,
  expires,
  onCode,
  onExpires,
  disabled,
}: {
  idPrefix: string;
  code: string;
  expires: string;
  onCode: (v: string) => void;
  onExpires: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="portal-boost-fields">
      <div>
        <label htmlFor={`${idPrefix}-code`} style={fieldLabel}>Boost code (optional)</label>
        <input
          id={`${idPrefix}-code`}
          value={code}
          onChange={(e) => onCode(e.target.value)}
          disabled={disabled}
          maxLength={300}
          autoComplete="off"
          placeholder="Spark Ads or partnership code"
          style={fieldStyle}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-exp`} style={fieldLabel}>Code expires</label>
        <input id={`${idPrefix}-exp`} type="date" value={expires} onChange={(e) => onExpires(e.target.value)} disabled={disabled || !code.trim()} style={fieldStyle} />
      </div>
    </div>
  );
}

function SubmitPosts({
  slug,
  checks,
  checksPlatform,
  boostCodes,
  onDone,
}: {
  slug: string;
  boostCodes: boolean;
  checks: RuleCheck[];
  checksPlatform: string | null;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Array<{ url: string; outcome: Outcome; message: string }> | null>(null);
  const [boostCode, setBoostCode] = useState("");
  const [boostExpires, setBoostExpires] = useState("");

  const links = useMemo(() => splitLinks(text), [text]);
  const preview = links.map((url) => ({ url, detected: detectPlatform(url) }));
  const usable = preview.filter((p) => p.detected).map((p) => p.url);
  const tooMany = usable.length > MAX_LINKS;
  /* A rule we measured and the creator fails (too few followers, posts
     already at the limit) refuses every link on that platform, so the button
     says so up front instead of after a round trip per link. Both rules are
     per platform, so a link on another platform is left to the server. */
  const failed = checks.find((c) => c.state === "fail") ?? null;
  const blocked =
    failed && (usable.length === 0 || usable.every((u) => detectPlatform(u)?.platform === checksPlatform)) ? failed : null;
  /* A boost code belongs to one post; with several links it is added per post
     under Your submissions. */
  const single = usable.length === 1;

  /* One request per link, one after another. The route reads each post live
     from the platform, so sending them in parallel would only race the same
     rate limits; a running count shows the creator it is moving. */
  const submit = async () => {
    if (usable.length === 0 || tooMany) return;
    setRunning(true);
    setResults(null);
    const out: Array<{ url: string; outcome: Outcome; message: string }> = [];
    for (let i = 0; i < usable.length; i++) {
      setProgress({ done: i, total: usable.length });
      const url = usable[i];
      try {
        const res = await fetch(`/api/portal/campaigns/${encodeURIComponent(slug)}/submissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            postUrl: url,
            ...(boostCodes && single && boostCode.trim()
              ? { boostCode: boostCode.trim(), boostCodeExpiresAt: boostExpires || null }
              : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) out.push({ url, outcome: "added", message: "Added" });
        else if (res.status === 409 && /already/i.test(data.error ?? ""))
          out.push({ url, outcome: "already", message: data.error });
        else if (res.status >= 400 && res.status < 500)
          out.push({ url, outcome: "rejected", message: data.error ?? "Not accepted" });
        else out.push({ url, outcome: "failed", message: data.error ?? "Couldn't submit. Try again." });
      } catch {
        out.push({ url, outcome: "failed", message: "Network error. Try again." });
      }
    }
    setProgress(null);
    setRunning(false);
    setResults(out);
    /* Keep only what did not go in, so a retry is one tap. */
    const leftover = out.filter((r) => r.outcome === "failed").map((r) => r.url);
    setText(leftover.join("\n"));
    if (out.some((r) => r.outcome === "added")) {
      setBoostCode("");
      setBoostExpires("");
    }
    onDone();
  };

  const count = (o: Outcome) => results?.filter((r) => r.outcome === o).length ?? 0;
  const notLinks = preview.length - usable.length;
  const summary = results
    ? [
        count("added") && `${count("added")} added`,
        count("already") && `${count("already")} already here`,
        count("rejected") && `${count("rejected")} not accepted`,
        count("failed") && `${count("failed")} failed`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Card>
      <SectionTitle>Submit your posts</SectionTitle>
      {checks.length > 0 && <RuleList checks={checks} />}
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "0 0 10px" }}>
        Paste one link or many, one per line. We work out the platform from each link.
      </p>
      <label htmlFor="post-links" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Post links
      </label>
      <textarea
        id="post-links"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        disabled={running}
        placeholder={"https://www.tiktok.com/@you/video/…\nhttps://www.instagram.com/reel/…"}
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid var(--cc-border)",
          fontSize: 16,
          lineHeight: 1.5,
          color: "var(--cc-text)",
          background: "var(--cc-card)",
          resize: "vertical",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      {preview.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
          {preview.map(({ url, detected }) => (
            <li key={url} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, minWidth: 0 }}>
              <StatusPill tone={detected ? "info" : "danger"}>
                {detected ? platformLabel(detected.platform) : "Not a post link"}
              </StatusPill>
              <span style={{ color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
            </li>
          ))}
        </ul>
      )}
      {boostCodes && single && (
        <div style={{ marginTop: 12 }}>
          <BoostFields idPrefix="submit-boost" code={boostCode} expires={boostExpires} onCode={setBoostCode} onExpires={setBoostExpires} disabled={running} />
        </div>
      )}
      {boostCodes && usable.length > 1 && (
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "10px 0 0" }}>
          Boost codes go on each post separately. Add them under Your submissions once these are in.
        </p>
      )}
      {tooMany && (
        <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "10px 0 0" }}>
          That&apos;s {usable.length} links. Send up to {MAX_LINKS} at a time.
        </p>
      )}
      {/* Sticky above the phone tab bar, so Submit stays in reach under a
          long list of links (globals.css .portal-submit-bar). */}
      <div className="portal-submit-bar" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <Button variant="primary" onClick={submit} loading={running} disabled={usable.length === 0 || tooMany || !!blocked}>
          {usable.length > 1 ? `Submit ${usable.length} posts` : "Submit post"}
        </Button>
        {progress && (
          <span role="status" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Sending {progress.done + 1} of {progress.total}…
          </span>
        )}
        {blocked && (
          <span role="status" style={{ fontSize: 13, color: "var(--cc-text)" }}>
            You can&apos;t submit to this campaign: {blocked.label.charAt(0).toLowerCase() + blocked.label.slice(1)}.
          </span>
        )}
        {!running && notLinks > 0 && usable.length > 0 && (
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            {notLinks === 1 ? "1 link isn't a post and will be skipped." : `${notLinks} links aren't posts and will be skipped.`}
          </span>
        )}
      </div>
      {results && (
        <div role="status" style={{ marginTop: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: "0 0 6px" }}>{summary}</p>
          {results
            .filter((r) => r.outcome !== "added")
            .map((r) => (
              <p key={r.url} style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "2px 0", overflowWrap: "anywhere" }}>
                {r.message}: {r.url}
              </p>
            ))}
        </div>
      )}
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "12px 0 0" }}>
        Views update by themselves when your account is connected.{" "}
        <Link href="/portal/accounts" style={{ color: "var(--cc-primary)", fontWeight: 600 }}>
          My accounts
        </Link>
      </p>
    </Card>
  );
}

function DraftCard({ slug, draft, onDone }: { slug: string; draft: Draft; onDone: () => void }) {
  const [draftUrl, setDraftUrl] = useState(draft.draftUrl ?? "");
  const [draftCaption, setDraftCaption] = useState(draft.draftCaption ?? "");
  const [draftMediaType, setDraftMediaType] = useState(draft.draftMediaType ?? "");
  const [saving, setSaving] = useState(false);
  const state = DRAFT_STATE[draft.status] ?? { tone: "neutral" as Tone, label: draft.status.replace(/_/g, " ").toLowerCase() };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftUrl.trim()) {
      toast.error("Add a link to your draft");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/portal/campaigns/${encodeURIComponent(slug)}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftUrl: draftUrl.trim(),
          draftCaption: draftCaption.trim() || undefined,
          draftMediaType: draftMediaType || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Draft sent for review");
        onDone();
      } else toast.error(data.error ?? "Couldn't send the draft");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <SectionTitle aside={<StatusPill tone={state.tone}>{state.label}</StatusPill>}>Draft for review</SectionTitle>
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "0 0 12px" }}>
        If the agency wants to see your content before it goes live, send a draft link here first.
      </p>
      {draft.status === "DECLINED" && draft.feedbackNotes && (
        <Banner tone="danger">
          <strong>Feedback:</strong> {draft.feedbackNotes}
        </Banner>
      )}
      {CAN_SUBMIT_DRAFT.includes(draft.status) ? (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Draft link" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="A Google Drive, Dropbox or any shareable link" />
          <Input label="Caption (optional)" value={draftCaption} onChange={(e) => setDraftCaption(e.target.value)} placeholder="The caption you plan to post with" />
          <div>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Content type</span>
            <Dropdown
              ariaLabel="Content type"
              align="left"
              fullWidth
              size="md"
              value={draftMediaType}
              onChange={setDraftMediaType}
              options={[{ value: "", label: "Not specified" }, ...MEDIA_TYPES.map((m) => ({ value: m, label: m.charAt(0) + m.slice(1).toLowerCase() }))]}
            />
          </div>
          <div>
            <Button variant="secondary" loading={saving}>
              {draft.status === "DECLINED" ? "Send the new draft" : draft.draftUrl ? "Update draft" : "Send draft"}
            </Button>
          </div>
        </form>
      ) : (
        draft.draftUrl && (
          <a href={draft.draftUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "var(--cc-primary)" }}>
            Your draft <ExternalLink size={13} aria-hidden="true" />
          </a>
        )
      )}
    </Card>
  );
}

/** A submission's boost code: shown, added or changed in place. With boost
    codes off for the campaign, a code already given is shown, not editable. */
function BoostCodeRow({ slug, submission, editable, onDone }: { slug: string; submission: Submission; editable: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(submission.boostCode ?? "");
  const [expires, setExpires] = useState(submission.boostCodeExpiresAt?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/portal/campaigns/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submission.id)}/boost-code`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ boostCode: code.trim(), boostCodeExpiresAt: expires || null }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the boost code");
        return;
      }
      toast.success(code.trim() ? "Boost code saved" : "Boost code removed");
      setEditing(false);
      onDone();
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const linkButton: React.CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--cc-primary)", fontWeight: 600, fontSize: 13 };

  if (editing) {
    return (
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <BoostFields idPrefix={`boost-${submission.id}`} code={code} expires={expires} onCode={setCode} onExpires={setExpires} disabled={saving} />
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" size="sm" loading={saving} onClick={save}>Save</Button>
          <Button variant="secondary" size="sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }
  if (submission.boostCode) {
    return (
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "6px 0 0", overflowWrap: "anywhere" }}>
        Boost code <code style={{ color: "var(--cc-text)", fontSize: 13 }}>{submission.boostCode}</code>
        {submission.boostCodeExpiresAt && <> · expires {formatDay(submission.boostCodeExpiresAt)}</>}
        {editable && (
          <>
            {" "}·{" "}
            <button type="button" className="rsp-touch" style={linkButton} onClick={() => setEditing(true)}>Change</button>
          </>
        )}
      </p>
    );
  }
  if (!editable) return null;
  return (
    <p style={{ margin: "6px 0 0" }}>
      <button type="button" className="rsp-touch" style={linkButton} onClick={() => setEditing(true)}>Add boost code</button>
    </p>
  );
}

function SubmissionList({ slug, submissions, currency, boostCodes, onDone }: { slug: string; submissions: Submission[]; currency: string; boostCodes: boolean; onDone: () => void }) {
  return (
    <div>
      <SectionTitle>Your submissions</SectionTitle>
      {submissions.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>Nothing yet. Your posts show here with their status and views.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {submissions.map((s) => {
            const state = SUBMISSION_STATE[s.status] ?? { tone: "neutral" as Tone, label: s.status };
            /* A 0 we never read is not a measurement (lib/metricDisplay); the
               route decides, because only it sees which counters were read. */
            const views = s.views;
            return (
              <div key={s.id} style={{ padding: 14, borderRadius: 12, border: "1px solid var(--cc-border)", background: "var(--cc-card)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <a
                    href={s.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}
                  >
                    {s.caption || s.postUrl}
                  </a>
                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                </div>
                <div style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 6 }}>
                  {platformLabel(s.platform)} ·{" "}
                  {views === null ? "views not read yet" : <strong style={{ color: "var(--cc-text)" }}>{formatCount(views)} views</strong>}
                  {s.lastSyncedAt && <> · updated {relativeDay(s.lastSyncedAt)}</>}
                  {SHOW_MONEY && s.earnedMinor > 0 && <> · {money(s.earnedMinor, currency)}</>}
                </div>
                {s.status === "REJECTED" && s.rejectionReason && (
                  <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "6px 0 0" }}>{s.rejectionReason}</p>
                )}
                {s.status !== "REJECTED" && <BoostCodeRow slug={slug} submission={s} editable={boostCodes} onDone={onDone} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CampaignScreen() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = params.slug;

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [joined, setJoined] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const banner = search.get("joined") === "1" || search.get("accepted") === "1"
    ? { tone: "success" as const, text: "You're on this campaign. Submit your posts below when they're live." }
    : search.get("joinError")
      ? { tone: "danger" as const, text: search.get("joinError") as string }
      : null;
  const [bannerShown, setBannerShown] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/campaigns/${encodeURIComponent(slug)}`);
      if (res.status === 401) {
        router.push(`/portal/login?join=${encodeURIComponent(slug)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 404 ? "This campaign isn't available to you." : data.error ?? "Couldn't load the campaign.");
        return;
      }
      setError(null);
      setDetail(data.campaign);
      setLoadedAt(Date.now());
      setJoined(!!data.joined);
      setDraft(data.draft ?? null);
      setSubmissions(data.submissions ?? []);
    } catch {
      setError("Network error. Try again.");
    }
  }, [slug, router]);

  useEffect(() => {
    load();
  }, [load]);

  const join = async () => {
    if (!detail?.slug) return;
    setJoining(true);
    try {
      const res = await fetch("/api/portal/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: detail.slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? "Couldn't join this campaign");
      else {
        toast.success("You've joined");
        await load();
      }
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setJoining(false);
    }
  };

  if (error) {
    return (
      <Screen title="Campaign">
        <EmptyState title={error} action={{ label: "Back to your campaigns", href: "/portal/campaigns" }} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen title="Campaign">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonBlock height={96} />
          <SkeletonBlock height={160} />
        </div>
      </Screen>
    );
  }

  const opensAt = detail.scheduledUntil ?? null;
  const status: { tone: Tone; label: string } = opensAt
    ? { tone: "info", label: `Opens ${formatDay(opensAt, { utc: true })}` }
    : !detail.acceptsPosts
    ? { tone: "neutral", label: "Closed" }
    : joined
      ? { tone: "success", label: "Joined" }
      : { tone: "info", label: "Open" };

  return (
    <Screen
      title={detail.title}
      subtitle={
        <>
          <Link href="/portal/campaigns" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--cc-text-muted)", textDecoration: "none" }}>
            <ArrowLeft size={14} aria-hidden="true" /> Campaigns
          </Link>{" "}
          · {detail.orgName}
        </>
      }
      action={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
    >
      {banner && bannerShown && (
        <Banner tone={banner.tone} onDismiss={() => setBannerShown(false)}>
          {banner.text}
        </Banner>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {detail.joinable && (
          <Card>
            <SectionTitle>Join this campaign</SectionTitle>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: "0 0 12px" }}>
              Anyone can join. Once you&apos;re in, post your content and submit the links here.
            </p>
            <Button variant="primary" loading={joining} onClick={join}>
              Join campaign
            </Button>
          </Card>
        )}

        <DatesCard dates={detail.dates} now={loadedAt} />
        <BriefCard detail={detail} />

        {joined && draft && detail.acceptsPosts && <DraftCard slug={slug} draft={draft} onDone={load} />}

        {joined && detail.acceptsPosts && <SubmitPosts slug={slug} checks={detail.ruleChecks ?? []} checksPlatform={detail.ruleChecksPlatform ?? null} boostCodes={detail.boostCodes === true} onDone={load} />}
        {opensAt && (
          <Banner tone="info">
            Posts open on {formatDay(opensAt, { utc: true })}. Read the brief now; you can submit your links from that day.
          </Banner>
        )}
        {joined && !detail.acceptsPosts && !opensAt && (
          <Banner tone="info">This campaign isn&apos;t taking new posts any more. Your submissions are below.</Banner>
        )}
        {!joined && !detail.joinable && !opensAt && (
          <Banner tone="info">This campaign is by invitation. Ask the agency for an invite link to join.</Banner>
        )}

        {joined && <SubmissionList slug={slug} submissions={submissions} currency={detail.currency} boostCodes={detail.boostCodes === true} onDone={load} />}
      </div>
    </Screen>
  );
}

export default function CreatorCampaignPage() {
  return (
    <Suspense fallback={null}>
      <CampaignScreen />
    </Suspense>
  );
}
