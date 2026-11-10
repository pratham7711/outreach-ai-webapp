"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { AtSign, Ban, CalendarClock, Check, ChevronLeft, CircleHelp, Clock, Copy, Download, ExternalLink, Eye, FileText, Film, Hash, Layers, Music, PenLine, PlayCircle, Send, Sparkles, ThumbsUp, UserCheck, UserPlus, Users, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { Input } from "@pratham7711/ui";
import { Button, Dropdown, Field } from "@/components/ds";
import { useDirty } from "@/lib/useDirty";
import { detectPlatform, MEDIA_TYPES } from "@/lib/platforms/postUrl";
import { SHOW_MONEY } from "@/lib/moneyUi";
import type { CampaignDate } from "@/lib/portal/campaignDates";
import { splitLinks } from "@/lib/portal/postLinks";
import { briefBlocks } from "@/lib/portal/briefBlocks";
import type { RuleCheck } from "@/lib/portal/submissionRules";
import {
  Banner,
  Card,
  EmptyState,
  Screen,
  SectionTitle,
  SkeletonBlock,
  StatusPill,
  formatExact,
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
  /** The release's TikTok / Instagram sounds, when the campaign promotes one. */
  sounds?: { platform: string; title: string; artist: string; url: string }[];
  /** Creators on the campaign (a count only). */
  creatorCount?: number;
  maxPostsPerAccount?: number | null;
  minFollowers?: number | null;
  requiredHashtags?: string[];
  requiredMentions?: string[];
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
      <SectionTitle><IconTitle icon={CalendarClock} tone="orange">Dates</IconTitle></SectionTitle>
      {dates.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>No dates set yet.</p>
      ) : (
        <ol className="portal-timeline">
          {dates.map((d) => {
            const past = new Date(d.at).getTime() < now - 86_400_000;
            return (
              <li key={`${d.kind}-${d.at}`} data-past={past || undefined} data-key={d.kind === "post_due" || undefined}>
                <span className="portal-timeline-dot" aria-hidden="true" />
                <span className="portal-timeline-label">{d.label}</span>
                <span className="portal-timeline-when">
                  <strong>{formatDay(d.at)}</strong>
                  <span className="portal-timeline-rel">{relativeDay(d.at)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

type ToneName = "violet" | "blue" | "pink" | "green" | "orange";

/* A section title with a small tinted icon tile, so each card reads at a glance. */
function IconTitle({ icon: Icon, tone, children }: { icon: typeof Check; tone: ToneName; children: React.ReactNode }) {
  return (
    <span className="portal-ttl">
      <span className="portal-ttl-icon" data-hue={tone} aria-hidden="true">
        <Icon size={15} />
      </span>
      {children}
    </span>
  );
}

/* The campaign's cover: the brand band behind the title, with the facts a
   creator weighs before posting (Content Rewards and Clipster put them in
   their headers). Each fact explains itself on hover or focus. */
function CampaignCover({ detail, status, now }: { detail: CampaignDetail; status: { tone: Tone; label: string }; now: number }) {
  const next = detail.dates.find((d) => new Date(d.at).getTime() >= now - 86_400_000);
  const facts: { key: string; icon: typeof Check; value: string; label: string; tip: string; hue: ToneName }[] = [];
  if (detail.creatorCount && detail.creatorCount > 0) {
    facts.push({ key: "creators", hue: "violet", icon: Users, value: formatExact(detail.creatorCount), label: detail.creatorCount === 1 ? "creator" : "creators", tip: "Creators who have joined this campaign" });
  }
  if (detail.maxPostsPerAccount) {
    facts.push({ key: "max", hue: "blue", icon: Layers, value: String(detail.maxPostsPerAccount), label: "posts per account", tip: "The most posts each of your accounts can submit" });
  }
  if (detail.minFollowers) {
    facts.push({ key: "followers", hue: "pink", icon: UserCheck, value: `${formatExact(detail.minFollowers)}+`, label: "followers", tip: "Followers your account needs on the platform you post to" });
  }
  if (next && detail.acceptsPosts) {
    facts.push({ key: "next", hue: "orange", icon: CalendarClock, value: formatDay(next.at), label: next.label.toLowerCase(), tip: `${next.label}: ${relativeDay(next.at)}` });
  }
  const art = detail.sounds?.[0];
  return (
    <header className="portal-cover">
      <Link href="/portal/campaigns" className="portal-cover-back">
        <ChevronLeft size={16} aria-hidden="true" /> Campaigns
      </Link>
      <div className="portal-cover-main">
        <span className="portal-cover-art" aria-hidden="true">
          <Music size={26} />
        </span>
        <div className="portal-cover-text">
          <div className="portal-cover-badges">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {art && (
              <span className="portal-cover-tag">
                <Music size={12} aria-hidden="true" /> {art.title}
              </span>
            )}
          </div>
          <h1 className="portal-cover-title">{detail.title}</h1>
          <p className="portal-cover-org">by {detail.orgName}</p>
        </div>
      </div>
      {facts.length > 0 && (
        <ul className="portal-cover-facts" aria-label="About this campaign">
          {facts.map((f) => (
            <li key={f.key}>
              <Tooltip>
                <TooltipTrigger render={<span className="portal-cover-fact" data-hue={f.hue} tabIndex={0} />}>
                  <span className="portal-cover-fact-icon" aria-hidden="true">
                    <f.icon size={16} />
                  </span>
                  <span className="portal-cover-fact-text">
                    <strong>{f.value}</strong>
                    <span>{f.label}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{f.tip}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

/* The sound a music campaign is about, one tap from the app that posts with it. */
/* What goes into the post: the sound as one row with its open buttons, and the
   caption tags as tokens. One card, so the phone isn't a stack of boxes. */
function CopyToken({ text, hue, icon: Icon }: { text: string; hue: ToneName; icon: typeof Check }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`Copied ${text}`);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy. Select the text instead.");
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" className="portal-token" data-hue={hue} onClick={copy} aria-label={`Copy ${text}`} />}>
        <Icon size={13} aria-hidden="true" />
        {text.slice(1)}
        {copied ? <Check size={13} aria-hidden="true" className="portal-token-act" /> : <Copy size={12} aria-hidden="true" className="portal-token-act" />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Tap to copy"}</TooltipContent>
    </Tooltip>
  );
}

function PostKit({ sounds, hashtags, mentions }: { sounds: NonNullable<CampaignDetail["sounds"]>; hashtags: string[]; mentions: string[] }) {
  const first = sounds[0];
  if (!first && hashtags.length + mentions.length === 0) return null;
  return (
    <Card>
      <SectionTitle><IconTitle icon={Sparkles} tone="pink">Use in your post</IconTitle></SectionTitle>
      {first && (
        <div className="portal-sound">
          <span className="portal-sound-art" aria-hidden="true">
            <Music size={20} />
          </span>
          <span className="portal-sound-text">
            <strong>{first.title}</strong>
            <span>{first.artist}</span>
          </span>
          <span className="portal-sound-links">
            {sounds.map((snd) => (
              <a
                key={snd.platform}
                href={snd.url}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-sound-link rsp-touch"
                aria-label={`Open the sound in ${platformLabel(snd.platform)}`}
                title={`Open in ${platformLabel(snd.platform)}`}
              >
                <PlatformGlyph platform={snd.platform} size={16} />
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            ))}
          </span>
        </div>
      )}
      {hashtags.length + mentions.length > 0 && (
        <ul className="portal-tokens" aria-label="Add to your caption" style={first ? { marginTop: 12 } : undefined}>
          {hashtags.map((h) => (
            <li key={h}><CopyToken text={`#${h.replace(/^#/, "")}`} hue="violet" icon={Hash} /></li>
          ))}
          {mentions.map((m) => (
            <li key={m}><CopyToken text={`@${m.replace(/^@/, "")}`} hue="blue" icon={AtSign} /></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BriefText({ text }: { text: string }) {
  const blocks = briefBlocks(text);
  const groups: { list: boolean; items: typeof blocks }[] = [];
  for (const b of blocks) {
    const list = b.kind === "li";
    const last = groups[groups.length - 1];
    if (last && last.list && list) last.items.push(b);
    else groups.push({ list, items: [b] });
  }
  return (
    <div className="portal-brief-text">
      {groups.map((g, i) =>
        g.list ? (
          <ul key={i}>
            {g.items.map((b, j) => (
              <li key={j}>{b.text}</li>
            ))}
          </ul>
        ) : (
          g.items.map((b, j) =>
            b.kind === "h" ? (
              <p key={`${i}-${j}`} className="portal-brief-h">{b.text}</p>
            ) : (
              <p key={`${i}-${j}`}>{b.text}</p>
            ),
          )
        ),
      )}
    </div>
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
  const empty = blocks.length === 0 && !hasChecklist && !detail.contentAssetsUrl && !(SHOW_MONEY && rates.length > 0);
  return empty ? null : <BriefFold after={hasChecklist ? <Checklist {...checklist} /> : null}>{blocks.map(([title, text]) => (
          <div key={title}>
            <SectionTitle><IconTitle icon={FileText} tone="violet">{title === "Brief" ? "What to make" : title}</IconTitle></SectionTitle>
            <BriefText text={text} />
          </div>
        ))}
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
        )}</BriefFold>;
}

/* On a phone the brief opens as a short preview with Read more, so the first
   screen isn't a wall of text. Desktop shows it whole. */
function BriefFold({ children, after }: { children: React.ReactNode; after?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 4);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <Card>
      <div ref={bodyRef} className="portal-brief-body" data-folded={open ? undefined : ""}>
        {children}
      </div>
      {(overflows || open) && (
        <button type="button" className="portal-brief-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Read full brief"}
        </button>
      )}
      {after && <div className="portal-brief-after">{after}</div>}
    </Card>
  );
}

const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 };
const rowStyle: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: "var(--cc-text)", lineHeight: 1.5 };
const iconStyle = (color: string): React.CSSProperties => ({ color, flexShrink: 0, marginTop: 3 });

/** The agency's do's and don'ts, and posts they point to as examples. */
function Checklist({ dos, donts, examples }: { dos: string[]; donts: string[]; examples: string[] }) {
  return (
    <div className="portal-dodont-wrap">
      {dos.length + donts.length > 0 && (
        <div className="portal-dodont">
          {dos.length > 0 && (
            <div className="portal-dodont-col" data-kind="do">
              <span className="portal-dodont-head">
                <ThumbsUp size={14} aria-hidden="true" /> Do
              </span>
              <ul>
                {dos.map((d) => (
                  <li key={d}>
                    <Check size={14} aria-hidden="true" /> {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {donts.length > 0 && (
            <div className="portal-dodont-col" data-kind="dont">
              <span className="portal-dodont-head">
                <Ban size={14} aria-hidden="true" /> Don&apos;t
              </span>
              <ul>
                {donts.map((d) => (
                  <li key={d}>
                    <X size={14} aria-hidden="true" /> {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {examples.length > 0 && (
        <div className="portal-examples">
          <span className="portal-examples-head">
            <PlayCircle size={14} aria-hidden="true" /> Examples
          </span>
          {examples.map((url, i) => {
            const d = detectPlatform(url);
            return (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="portal-example rsp-touch">
                {d ? <PlatformGlyph platform={d.platform} size={14} /> : null}
                {d ? `${platformLabel(d.platform)} ${i + 1}` : `Example ${i + 1}`}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            );
          })}
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
  const shown = checks.filter((c) => c.state === "fail" || c.state === "unknown");
  if (shown.length === 0) return null;
  return (
    <div style={{ margin: "0 0 14px" }}>
      <ul style={listStyle} data-testid="portal-rule-checks">
        {shown.map((c) => {
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
      <Field label="Boost code">
        <Input
          id={`${idPrefix}-code`}
          value={code}
          onChange={(e) => onCode(e.target.value)}
          disabled={disabled}
          maxLength={300}
          autoComplete="off"
          placeholder="Spark Ads or partnership code"
        />
      </Field>
      <Field label="Code expires">
        <Input id={`${idPrefix}-exp`} type="date" value={expires} onChange={(e) => onExpires(e.target.value)} disabled={disabled || !code.trim()} />
      </Field>
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
        const send = (withCode: boolean) =>
          fetch(`/api/portal/campaigns/${encodeURIComponent(slug)}/submissions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              postUrl: url,
              ...(withCode ? { boostCode: boostCode.trim(), boostCodeExpiresAt: boostExpires || null } : {}),
            }),
          });
        const withCode = boostCodes && single && boostCode.trim() !== "";
        let res = await send(withCode);
        let data = await res.json().catch(() => ({}));
        /* The agency switched boost codes off after this page loaded. The
           server refuses the code before creating anything, so send the post
           again without it and say the code was not kept, rather than make
           the creator clear the field and submit a second time. */
        let codeDropped = false;
        if (withCode && res.status === 403 && data.code === "boost_codes_off") {
          res = await send(false);
          data = await res.json().catch(() => ({}));
          codeDropped = res.ok;
        }
        if (res.ok)
          out.push({
            url,
            outcome: "added",
            message: codeDropped ? "Added without the boost code, which this campaign no longer takes" : "Added",
          });
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
      <SectionTitle><IconTitle icon={Send} tone="blue">Submit your posts</IconTitle></SectionTitle>
      {checks.length > 0 && <RuleList checks={checks} />}
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
          borderRadius: "var(--cc-r-control)",
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
            .filter((r) => r.outcome !== "added" || r.message !== "Added")
            .map((r) => (
              <p key={r.url} style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "2px 0", overflowWrap: "anywhere" }}>
                {r.message}: {r.url}
              </p>
            ))}
        </div>
      )}
      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "12px 0 0" }}>
        Submit as soon as it&apos;s live.
      </p>
    </Card>
  );
}

function DraftCard({ slug, draft, onDone }: { slug: string; draft: Draft; onDone: () => void }) {
  const [draftUrl, setDraftUrl] = useState(draft.draftUrl ?? "");
  const [draftCaption, setDraftCaption] = useState(draft.draftCaption ?? "");
  const [draftMediaType, setDraftMediaType] = useState(draft.draftMediaType ?? "");
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(!!draft.draftUrl || draft.status === "DECLINED");
  const state = DRAFT_STATE[draft.status] ?? { tone: "neutral" as Tone, label: draft.status.replace(/_/g, " ").toLowerCase() };
  const dirty = useDirty(
    { draftUrl: draft.draftUrl ?? "", draftCaption: draft.draftCaption ?? "", draftMediaType: draft.draftMediaType ?? "" },
    { draftUrl, draftCaption, draftMediaType },
  );
  /* A draft still waiting for review is an edit: it resends only once
     something changed. A declined one goes back as it is if the creator
     changed the file behind the same link. */
  const canSend = !!draftUrl.trim() && (draft.status !== "DRAFT_SUBMITTED" || dirty);

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

  if (!CAN_SUBMIT_DRAFT.includes(draft.status) && !draft.draftUrl) {
    return (
      <Card>
        <div className="portal-row-between">
          <IconTitle icon={PenLine} tone="orange">
            <span className="portal-row-title">Draft</span>
          </IconTitle>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <SectionTitle aside={<StatusPill tone={state.tone}>{state.label}</StatusPill>}><IconTitle icon={PenLine} tone="orange">Draft for review</IconTitle></SectionTitle>
      {draft.status === "DECLINED" && draft.feedbackNotes && (
        <Banner tone="danger">
          <strong>Feedback:</strong> {draft.feedbackNotes}
        </Banner>
      )}
      {CAN_SUBMIT_DRAFT.includes(draft.status) && !formOpen ? (
        <div>
          <Button type="button" variant="secondary" iconLeft={<PenLine size={15} aria-hidden="true" />} onClick={() => setFormOpen(true)}>
            Send a draft
          </Button>
        </div>
      ) : CAN_SUBMIT_DRAFT.includes(draft.status) ? (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Draft link">
            <Input autoFocus={!draft.draftUrl} value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="A Google Drive, Dropbox or any shareable link" />
          </Field>
          <Field label="Caption">
            <Input value={draftCaption} onChange={(e) => setDraftCaption(e.target.value)} placeholder="The caption you plan to post with" />
          </Field>
          <Field label="Content type">
            <Dropdown
              align="left"
              fullWidth
              size="md"
              value={draftMediaType}
              onChange={setDraftMediaType}
              options={[{ value: "", label: "Not specified" }, ...MEDIA_TYPES.map((m) => ({ value: m, label: m.charAt(0) + m.slice(1).toLowerCase() }))]}
            />
          </Field>
          <div>
            <Button type="submit" variant="secondary" loading={saving} disabled={!canSend}>
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
  const savedCode = { code: submission.boostCode ?? "", expires: submission.boostCodeExpiresAt?.slice(0, 10) ?? "" };
  const dirty = useDirty(savedCode, { code, expires });

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
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>Save</Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => {
              setCode(savedCode.code);
              setExpires(savedCode.expires);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
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
      <SectionTitle><IconTitle icon={Film} tone="green">Your submissions</IconTitle></SectionTitle>
      {submissions.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>No posts yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {submissions.map((s) => {
            const state = SUBMISSION_STATE[s.status] ?? { tone: "neutral" as Tone, label: s.status };
            /* A 0 we never read is not a measurement (lib/metricDisplay); the
               route decides, because only it sees which counters were read. */
            const views = s.views;
            return (
              <div key={s.id} style={{ padding: 14, borderRadius: "var(--cc-r-card)", border: "1px solid var(--cc-border)", background: "var(--cc-card)" }}>
                <div className="portal-sub-row">
                  <span className="portal-sub-glyph" aria-hidden="true">
                    <PlatformGlyph platform={s.platform} size={18} />
                  </span>
                  <div className="portal-sub-body">
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, minWidth: 0, width: "100%" }}>
                  <a
                    href={s.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ minWidth: 0, maxWidth: "100%", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}
                  >
                    {s.caption || s.postUrl}
                  </a>
                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                </div>
                  </div>
                  <Tooltip>
                    <TooltipTrigger render={<span className="portal-sub-views" tabIndex={0} />}>
                      <strong>{views === null ? "–" : formatExact(views)}</strong>
                      <span>
                        <Eye size={12} aria-hidden="true" /> views
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {views === null ? "Views not read yet" : `${views.toLocaleString()} views on ${platformLabel(s.platform)}`}
                      {SHOW_MONEY && s.earnedMinor > 0 ? ` · ${money(s.earnedMinor, currency)}` : ""}
                    </TooltipContent>
                  </Tooltip>
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
      <Screen title="Campaign" back={{ href: "/portal/campaigns", label: "Campaigns" }}>
        <EmptyState title={error} action={{ label: "Back to your campaigns", href: "/portal/campaigns" }} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen title="Campaign" back={{ href: "/portal/campaigns", label: "Campaigns" }}>
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

  const sounds = detail.sounds ?? [];
  const canSubmit = joined && detail.acceptsPosts;
  const stillPosting = detail.acceptsPosts || detail.joinable || !!opensAt;

  /* Desktop: what to make on the left, what to do and the facts on a rail
     that stays beside it while the brief scrolls (Content Rewards, Clipster).
     Phone: one column, the action first, and a bar at the bottom that brings
     it back once it has scrolled away. */
  return (
    <Screen title={detail.title} maxWidth={1080} hero={<CampaignCover detail={detail} status={status} now={loadedAt} />}>
      {banner && bannerShown && (
        <Banner tone={banner.tone} onDismiss={() => setBannerShown(false)}>
          {banner.text}
        </Banner>
      )}



      <div className="portal-campaign-grid">
        <aside className="portal-campaign-rail">
          <div className={`portal-slot portal-slot-action${canSubmit || detail.joinable ? "" : " portal-slot-first"}`}>
            {detail.joinable && (
              <Card>
                <div id="portal-action" className="portal-action-anchor">
                  <SectionTitle><IconTitle icon={UserPlus} tone="blue">Join this campaign</IconTitle></SectionTitle>
                    <Button variant="primary" loading={joining} onClick={join}>
                    Join campaign
                  </Button>
                </div>
              </Card>
            )}
            {canSubmit && (
              <div id="portal-action" className="portal-action-anchor">
                <SubmitPosts slug={slug} checks={detail.ruleChecks ?? []} checksPlatform={detail.ruleChecksPlatform ?? null} boostCodes={detail.boostCodes === true} onDone={load} />
              </div>
            )}
            {opensAt && (
              <Banner tone="info">
                Posts open {formatDay(opensAt, { utc: true })}.
              </Banner>
            )}
            {joined && !detail.acceptsPosts && !opensAt && (
              <Banner tone="info">No longer taking posts.</Banner>
            )}
            {!joined && !detail.joinable && !opensAt && (
              <Banner tone="info">Invite only. Ask the agency for a link.</Banner>
            )}
          </div>
          {stillPosting && (
            <div className="portal-slot portal-slot-sound">
              <PostKit sounds={sounds} hashtags={detail.requiredHashtags ?? []} mentions={detail.requiredMentions ?? []} />
            </div>
          )}
          {(stillPosting || detail.dates.length > 0) && (
            <div className="portal-slot portal-slot-dates">
              <DatesCard dates={detail.dates} now={loadedAt} />
            </div>
          )}
        </aside>

        <div className="portal-campaign-main">
          <div className="portal-slot portal-slot-brief">
            <BriefCard detail={detail} />
          </div>
          {joined && draft && detail.acceptsPosts && (
            <div className="portal-slot portal-slot-draft">
              <DraftCard slug={slug} draft={draft} onDone={load} />
            </div>
          )}
          {joined && (
            <div className="portal-slot portal-slot-subs">
              <SubmissionList slug={slug} submissions={submissions} currency={detail.currency} boostCodes={detail.boostCodes === true} onDone={load} />
            </div>
          )}
        </div>
      </div>

      {(canSubmit || detail.joinable) && (
        <StickyAction
          label={canSubmit ? "Submit a post" : "Join campaign"}
          loading={!canSubmit && joining}
          onClick={canSubmit ? undefined : join}
        />
      )}
    </Screen>
  );
}

/* Phone only: whenever the Join / Submit card is off screen, above or below
   (the brief comes first on a phone), a bar above the tab bar scrolls to it
   (Submit) or does it (Join). */
function StickyAction({ label, onClick, loading }: { label: string; onClick?: () => void; loading?: boolean }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const target = document.getElementById("portal-action");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0, rootMargin: "0px 0px -160px 0px" });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  return (
    <div className="portal-sticky-action" data-hidden={hidden || undefined}>
      <Button
        variant="primary"
        fullWidth
        loading={loading}
        onClick={() => {
          if (onClick) onClick();
          else document.getElementById("portal-action")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        {label}
      </Button>
    </div>
  );
}

export default function CreatorCampaignPage() {
  return (
    <Suspense fallback={null}>
      <CampaignScreen />
    </Suspense>
  );
}
