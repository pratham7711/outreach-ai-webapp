"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { Button, SectionCard } from "@/components/ds";
import { RULE_LIMITS, type CampaignRules } from "@/lib/campaigns/rulesShape";
import { detectPlatform } from "@/lib/platforms/postUrl";
import { platformLabel } from "@/lib/format";

/**
 * The campaign's creator checklist, submission rules, launch date and view
 * goal (lib/campaigns/rules), on the Overview beside the free-text brief.
 *
 * The checklist is what the creator app shows as ✓ / ✗ above the submit box;
 * the rules are checked when a creator submits; the launch date replaces the
 * first post as the charts' marker and keeps the campaign off Explore until
 * then; the goal is shown on the Views tile.
 *
 * Hidden entirely while the database has no CampaignRules table, so a
 * deployment that runs ahead of its DDL shows nothing new.
 */

type Draft = {
  dos: string[];
  donts: string[];
  examplePostUrls: string[];
  minFollowers: string;
  requiredHashtags: string;
  requiredMentions: string;
  maxPostsPerAccount: string;
  launchDay: string;
  viewGoal: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
/* The launch is a calendar day, stored as that day's 00:00 UTC, so every
   screen (campaign list, portal, chart marker) names the same day whatever
   the viewer's timezone. */
function launchDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function dayToIso(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString();
}

function toDraft(r: CampaignRules): Draft {
  return {
    dos: r.dos,
    donts: r.donts,
    examplePostUrls: r.examplePostUrls,
    minFollowers: r.minFollowers === null ? "" : String(r.minFollowers),
    requiredHashtags: r.requiredHashtags.join(" "),
    requiredMentions: r.requiredMentions.join(" "),
    maxPostsPerAccount: r.maxPostsPerAccount === null ? "" : String(r.maxPostsPerAccount),
    launchDay: launchDay(r.launchAt),
    viewGoal: r.viewGoal === null ? "" : String(r.viewGoal),
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const label: React.CSSProperties = { display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 };
const hint: React.CSSProperties = { fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "4px 0 0" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8,
  border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text)",
  fontSize: "var(--cc-t-14)", font: "inherit",
};
const sectionTitle: React.CSSProperties = {
  fontSize: "var(--cc-t-12)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text-muted)",
  textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px",
};

function ListEditor({
  items, onChange, max, addLabel, placeholder, name,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  max: number;
  addLabel: string;
  placeholder: string;
  name: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input
            aria-label={`${name} ${i + 1}`}
            value={item}
            maxLength={RULE_LIMITS.itemLength}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            style={input}
          />
          <button
            type="button"
            aria-label={`Remove ${name.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="rsp-touch"
            style={{ border: "1px solid var(--cc-border)", background: "var(--cc-card)", borderRadius: 8, padding: "0 8px", cursor: "pointer", color: "var(--cc-text-muted)" }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      {items.length < max && (
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="rsp-touch"
          style={{
            alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "none",
            padding: "4px 0", color: "var(--cc-primary)", fontWeight: "var(--cc-fw-strong)", fontSize: "var(--cc-t-13)", cursor: "pointer",
          }}
        >
          <Plus size={14} aria-hidden="true" /> {addLabel}
        </button>
      )}
    </div>
  );
}

function Checklist({ rules }: { rules: CampaignRules }) {
  if (rules.dos.length + rules.donts.length + rules.examplePostUrls.length === 0) return null;
  return (
    <div>
      <p style={sectionTitle}>Creator checklist</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {rules.dos.map((d) => (
          <li key={`do-${d}`} style={{ display: "flex", gap: 8, fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>
            <Check size={16} aria-label="Do" style={{ color: "var(--cc-success)", flexShrink: 0, marginTop: 2 }} /> {d}
          </li>
        ))}
        {rules.donts.map((d) => (
          <li key={`dont-${d}`} style={{ display: "flex", gap: 8, fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>
            <X size={16} aria-label="Don't" style={{ color: "var(--cc-danger)", flexShrink: 0, marginTop: 2 }} /> {d}
          </li>
        ))}
      </ul>
      {rules.examplePostUrls.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          Examples:
          {rules.examplePostUrls.map((u, i) => {
            const p = detectPlatform(u);
            return (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" style={{ color: "var(--cc-primary)", fontWeight: "var(--cc-fw-strong)" }}>
                {p ? platformLabel(p.platform) : "Link"} example {i + 1}
              </a>
            );
          })}
        </p>
      )}
    </div>
  );
}

function RuleLines({ rules, now }: { rules: CampaignRules; now: number }) {
  const lines: [string, string][] = [];
  if (rules.minFollowers) lines.push(["Minimum followers", fmt(rules.minFollowers)]);
  if (rules.requiredHashtags.length) lines.push(["Caption hashtags", rules.requiredHashtags.join(" ")]);
  if (rules.requiredMentions.length) lines.push(["Caption mentions", rules.requiredMentions.join(" ")]);
  if (rules.maxPostsPerAccount) lines.push(["Posts per account", `Up to ${rules.maxPostsPerAccount}`]);
  if (rules.launchAt) {
    const ahead = new Date(rules.launchAt).getTime() > now;
    lines.push(["Launch", `${fmtDay(rules.launchAt)}${ahead ? " · Scheduled: off Explore and not taking posts until then" : ""}`]);
  }
  if (rules.viewGoal) lines.push(["View goal", fmt(rules.viewGoal)]);
  if (lines.length === 0) return null;
  return (
    <div>
      <p style={sectionTitle}>Rules, launch and goal</p>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", fontSize: "var(--cc-t-14)" }}>
        {lines.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt style={{ color: "var(--cc-text-muted)" }}>{k}</dt>
            <dd style={{ margin: 0, color: "var(--cc-text)", overflowWrap: "anywhere" }}>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

export default function CampaignRulesCard({
  campaignId, onRules,
}: {
  campaignId: string;
  /** The saved rules, each time they load or change: the Views tile reads the goal. */
  onRules?: (rules: CampaignRules | null) => void;
}) {
  const [rules, setRules] = useState<CampaignRules | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/${campaignId}/rules`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { rules?: CampaignRules; ready?: boolean } | null) => {
        if (!live || !body?.rules) return;
        setRules(body.rules);
        setReady(body.ready === true);
        onRules?.(body.rules);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [campaignId, onRules]);

  if (!ready || !rules) return null;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dos: draft.dos,
          donts: draft.donts,
          examplePostUrls: draft.examplePostUrls,
          minFollowers: draft.minFollowers,
          requiredHashtags: [draft.requiredHashtags],
          requiredMentions: [draft.requiredMentions],
          maxPostsPerAccount: draft.maxPostsPerAccount,
          launchAt: draft.launchDay ? dayToIso(draft.launchDay) : null,
          viewGoal: draft.viewGoal,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't save. Try again.");
        return;
      }
      setRules(body.rules);
      onRules?.(body.rules);
      setDraft(null);
      toast.success("Checklist and rules saved");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const empty =
    rules.dos.length + rules.donts.length + rules.examplePostUrls.length + rules.requiredHashtags.length + rules.requiredMentions.length === 0 &&
    !rules.minFollowers && !rules.maxPostsPerAccount && !rules.launchAt && !rules.viewGoal;

  return (
    <SectionCard
      id="campaign-rules-card"
      title="Creator checklist & rules"
      action={
        !draft ? (
          <Button variant="secondary" size="sm" onClick={() => setDraft(toDraft(rules))}>
            {empty ? "Set up" : "Edit"}
          </Button>
        ) : undefined
      }
    >

      {!draft ? (
        empty ? (
          <p className="cc-campaign-card-note">
            Nothing set. Add what creators should and shouldn&apos;t do, example posts, the rules a submission must meet, a launch date or a view goal.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Checklist rules={rules} />
            <RuleLines rules={rules} now={now} />
          </div>
        )
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          <div className="cc-rules-two">
            <div>
              <span style={label}>Do</span>
              <ListEditor name="Do" items={draft.dos} onChange={(v) => set("dos", v)} max={RULE_LIMITS.listItems} addLabel="Add a do" placeholder="Show the product in the first 3 seconds" />
            </div>
            <div>
              <span style={label}>Don&apos;t</span>
              <ListEditor name="Don't" items={draft.donts} onChange={(v) => set("donts", v)} max={RULE_LIMITS.listItems} addLabel="Add a don't" placeholder="Use another brand's audio" />
            </div>
          </div>
          <div>
            <span style={label}>Example posts</span>
            <ListEditor name="Example post" items={draft.examplePostUrls} onChange={(v) => set("examplePostUrls", v)} max={RULE_LIMITS.examples} addLabel="Add an example post" placeholder="https://www.tiktok.com/@creator/video/…" />
          </div>

          <div className="cc-rules-two">
            <label>
              <span style={label}>Minimum followers</span>
              <input inputMode="numeric" value={draft.minFollowers} onChange={(e) => set("minFollowers", e.target.value)} placeholder="None" style={input} />
              <p style={hint}>Checked against the creator&apos;s latest follower reading. If we haven&apos;t read it, the post goes through with a note for you.</p>
            </label>
            <label>
              <span style={label}>Posts per account</span>
              <input inputMode="numeric" value={draft.maxPostsPerAccount} onChange={(e) => set("maxPostsPerAccount", e.target.value)} placeholder="No limit" style={input} />
              <p style={hint}>Live posts one creator can submit on each platform.</p>
            </label>
            <label>
              <span style={label}>Caption must include hashtags</span>
              <input value={draft.requiredHashtags} onChange={(e) => set("requiredHashtags", e.target.value)} placeholder="#summer #brandname" style={input} />
            </label>
            <label>
              <span style={label}>Caption must mention</span>
              <input value={draft.requiredMentions} onChange={(e) => set("requiredMentions", e.target.value)} placeholder="@brandname" style={input} />
              <p style={hint}>Checked on the caption the platform returns. A caption we can&apos;t read goes through with a note.</p>
            </label>
            <label>
              <span style={label}>Launch date</span>
              <input type="date" value={draft.launchDay} onChange={(e) => set("launchDay", e.target.value)} style={input} />
              <p style={hint}>Until then the campaign is off Explore and doesn&apos;t take posts. Charts mark it instead of the first post.</p>
            </label>
            <label>
              <span style={label}>View goal</span>
              <input inputMode="numeric" value={draft.viewGoal} onChange={(e) => set("viewGoal", e.target.value)} placeholder="None" style={input} />
              <p style={hint}>Shown on the Views tile as progress toward it.</p>
            </label>
          </div>

          {error && (
            <p role="alert" className="cc-form-error">
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" type="button" onClick={() => { setDraft(null); setError(null); }} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}
