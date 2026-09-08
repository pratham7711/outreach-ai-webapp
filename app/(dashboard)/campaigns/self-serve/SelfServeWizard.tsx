"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Badge, Card, EmptyState } from "@pratham7711/ui";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Check, Search, Users, Info } from "lucide-react";
import { computeSelfServeBudget } from "@/lib/campaigns/selfServeBudget";
import { stripAt, formatCompact } from "@/lib/format";
import { Dropdown, Button } from "@/components/ds";

type Currency = "USD" | "EUR" | "GBP" | "INR";
type Platform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITTER";

type Creator = {
  id: string;
  name: string;
  handle: string;
  platform: Platform;
  followersCount: number;
  averageViews: number;
  rate: number | null;
  niches?: string[];
};

const PLATFORMS: Platform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"];
const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "INR"];
const NICHES = [
  "MUSIC", "FASHION", "TECH", "FITNESS", "BEAUTY", "FOOD",
  "TRAVEL", "GAMING", "COMEDY", "EDUCATION", "LIFESTYLE", "SPORTS",
];

const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };

const STEPS = ["Basics", "Creators", "Review"];

// The API caps a page at 200. Asking for that many keeps the niche and max-rate
// passes below working on a decent slice, and the list says so when the org has
// more matches than one page holds.
const CREATOR_FETCH_LIMIT = 200;

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--cc-text)",
  marginBottom: 6,
};

const controlStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  fontSize: 14,
  color: "var(--cc-text)",
  background: "var(--cc-card)",
  boxSizing: "border-box",
};

function money(currency: Currency, amount: number): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatFollowers(n: number): string {
  return formatCompact(n);
}

export default function SelfServeWizard({
  defaultCurrency,
  platformFeeMinor,
}: {
  defaultCurrency: string;
  platformFeeMinor: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState<Currency>(
    (CURRENCIES as string[]).includes(defaultCurrency) ? (defaultCurrency as Currency) : "USD"
  );
  const [guidelines, setGuidelines] = useState("");

  const [creators, setCreators] = useState<Creator[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const [creatorError, setCreatorError] = useState("");
  const [selected, setSelected] = useState<Record<string, Creator>>({});

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debouncedMinFollowers, setDebouncedMinFollowers] = useState("");
  const [matchTotal, setMatchTotal] = useState<number | null>(null);
  const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
  const [nicheFilter, setNicheFilter] = useState<string>("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxRate, setMaxRate] = useState("");

  // Both of these are typed a character at a time, and each character would
  // otherwise be its own query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedMinFollowers(minFollowers.trim()), 300);
    return () => clearTimeout(t);
  }, [minFollowers]);

  /* Search, platform and min-followers are filters the API applies in SQL, so
     they are sent rather than applied to whatever page came back. They used not
     to be: this fetched the first 200 creators and filtered that array, which
     with 1,834 creators meant picking INSTAGRAM offered 4 of the org's 241.
     Niche and max-rate have no server-side equivalent and still narrow the page
     locally, which is why the count below says what it is showing out of. */
  useEffect(() => {
    let active = true;
    setLoadingCreators(true);
    setCreatorError("");
    const params = new URLSearchParams({ limit: String(CREATOR_FETCH_LIMIT) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (platformFilter) params.set("platform", platformFilter);
    if (Number(debouncedMinFollowers) > 0) params.set("minFollowers", debouncedMinFollowers);
    fetch(`/api/creators?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load creators");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setCreators(Array.isArray(data.creators) ? data.creators : []);
        setMatchTotal(typeof data.pagination?.total === "number" ? data.pagination.total : null);
      })
      .catch(() => {
        if (!active) return;
        setCreatorError("Could not load your creators. Please try again.");
      })
      .finally(() => {
        if (active) setLoadingCreators(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedSearch, platformFilter, debouncedMinFollowers]);

  const filteredCreators = useMemo(() => {
    const maxR = maxRate.trim() === "" ? Infinity : Number(maxRate);
    return creators.filter((c) => {
      if (nicheFilter && !(c.niches ?? []).includes(nicheFilter)) return false;
      const rate = typeof c.rate === "number" ? c.rate : 0;
      if (Number.isFinite(maxR) && rate > maxR) return false;
      return true;
    });
  }, [creators, nicheFilter, maxRate]);

  const selectedList = useMemo(() => Object.values(selected), [selected]);

  const budgetSummary = useMemo(
    () =>
      computeSelfServeBudget({
        // Passed through as null rather than coerced: the summary needs to be
        // able to say the total is short, not quietly absorb a missing price.
        creatorRates: selectedList.map((c) => (typeof c.rate === "number" ? c.rate : null)),
        platformFeeMinor,
        currency,
      }),
    [selectedList, platformFeeMinor, currency]
  );

  const budgetTarget = Number(budget) || 0;
  const overBudget = budgetTarget > 0 && budgetSummary.total > budgetTarget;
  const progressPct = budgetTarget > 0 ? Math.min(100, (budgetSummary.total / budgetTarget) * 100) : 0;

  const toggleCreator = (creator: Creator) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[creator.id]) delete next[creator.id];
      else next[creator.id] = creator;
      return next;
    });
  };

  const canNext = () => {
    if (step === 0) return title.trim().length > 0;
    if (step === 1) return selectedList.length > 0;
    return true;
  };

  const handleSubmit = async () => {
    if (selectedList.length === 0) {
      toast.error("Select at least one creator");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/campaigns/self-serve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          budget: budgetTarget > 0 ? budgetTarget : null,
          currency,
          guidelines: guidelines.trim() || null,
          creatorIds: selectedList.map((c) => c.id),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to create campaign");
        setSubmitting(false);
        return;
      }
      toast.success(`Campaign created — ${data.invitedCount} creator${data.invitedCount === 1 ? "" : "s"} shortlisted`);
      router.push(`/campaigns/${data.campaignId}`);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="cc-page-content" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          Self-serve campaign
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Set a budget, shortlist creators, and pay a flat platform fee. Invite &amp; negotiate from the campaign page.
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {STEPS.map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= step ? "var(--cc-primary)" : "var(--cc-border)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 20, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Step {step + 1} of {STEPS.length} — {STEPS[step]}
      </p>

      <Card variant="solid">
        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Input
              label="Campaign title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Spring Launch 2026"
              required
            />
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="Budget target"
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="e.g. 10000"
                />
              </div>
              <div style={{ width: 120 }}>
                <label htmlFor="ss-currency" style={labelStyle}>Currency</label>
                <Dropdown
                  ariaLabel="Currency"
                  align="left"
                  fullWidth
                  size="md"
                  value={currency}
                  onChange={(v) => setCurrency(v as Currency)}
                  options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                />
              </div>
            </div>
            <div>
              <label htmlFor="ss-guidelines" style={labelStyle}>Brief / guidelines</label>
              <textarea
                id="ss-guidelines"
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
                placeholder="Describe the campaign, deliverables, tone, and any content requirements..."
                rows={5}
                style={{ ...controlStyle, resize: "vertical" }}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div style={{ flex: "1 1 200px", minWidth: 180 }}>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search creators"
                  iconLeft={<Search size={16} />}
                />
              </div>
              <Dropdown
                ariaLabel="Platform"
                align="left"
                size="md"
                minWidth={130}
                value={platformFilter}
                onChange={(v) => setPlatformFilter(v as Platform | "")}
                options={[
                  { value: "", label: "All platforms" },
                  ...PLATFORMS.map((p) => ({ value: p, label: p })),
                ]}
              />
              <Dropdown
                ariaLabel="Niche"
                align="left"
                size="md"
                minWidth={130}
                value={nicheFilter}
                onChange={setNicheFilter}
                options={[
                  { value: "", label: "All niches" },
                  ...NICHES.map((n) => ({ value: n, label: n.charAt(0) + n.slice(1).toLowerCase() })),
                ]}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div style={{ flex: "1 1 160px" }}>
                <Input
                  type="number"
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(e.target.value)}
                  placeholder="Min followers"
                />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <Input
                  type="number"
                  value={maxRate}
                  onChange={(e) => setMaxRate(e.target.value)}
                  placeholder={`Max rate (${CURRENCY_SYMBOL[currency]})`}
                />
              </div>
            </div>

            {loadingCreators ? (
              <p style={{ fontSize: 14, color: "var(--cc-text-muted)", padding: "24px 0", textAlign: "center" }}>Loading creators…</p>
            ) : creatorError ? (
              <p style={{ fontSize: 14, color: "var(--cc-danger)", padding: "24px 0", textAlign: "center" }}>{creatorError}</p>
            ) : filteredCreators.length === 0 ? (
              <div style={{ padding: "24px 0" }}>
                <EmptyState
                  icon={<Search size={32} color="var(--cc-text-subtle)" />}
                  title={creators.length === 0 ? "No creators yet" : "No creators match your filters"}
                  description={creators.length === 0 ? "Add creators to your organization first." : "Try adjusting your filters."}
                />
              </div>
            ) : (
              <>
              {matchTotal !== null && matchTotal > creators.length && (
                <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                  Showing {creators.length} of {matchTotal} matching creators — narrow the search to see the rest.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--cc-border)", borderRadius: 10, overflow: "hidden", maxHeight: 360, overflowY: "auto" }}>
                {filteredCreators.map((c, i) => {
                  const isSelected = Boolean(selected[c.id]);
                  const rate = typeof c.rate === "number" ? c.rate : 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCreator(c)}
                      aria-pressed={isSelected}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 14px",
                        textAlign: "left",
                        background: isSelected ? "var(--cc-primary-light)" : "var(--cc-card)",
                        border: "none",
                        borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          flexShrink: 0,
                          border: `2px solid ${isSelected ? "var(--cc-primary)" : "var(--cc-border)"}`,
                          background: isSelected ? "var(--cc-primary)" : "var(--cc-card)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                        }}
                      >
                        {isSelected && <Check size={13} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span title={c.name} style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.name}
                        </span>
                        <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)" }}>
                          @{stripAt(c.handle)} · {c.platform} · {formatFollowers(c.followersCount)} followers
                        </span>
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", flexShrink: 0 }}>
                        {rate > 0 ? money(currency, rate) : "No rate"}
                      </span>
                    </button>
                  );
                })}
              </div>
              </>
            )}

            <RunningTotal
              currency={currency}
              creatorTotal={budgetSummary.creatorTotal}
              platformFee={budgetSummary.platformFee}
              total={budgetSummary.total}
              count={selectedList.length}
              unpricedCreators={budgetSummary.unpricedCreators}
              budgetTarget={budgetTarget}
              overBudget={overBudget}
              progressPct={progressPct}
            />
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>{title || "Untitled campaign"}</h2>
              <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                {selectedList.length} creator{selectedList.length === 1 ? "" : "s"} shortlisted
                {budgetTarget > 0 ? ` · Budget target ${money(currency, budgetTarget)}` : ""}
              </p>
            </div>

            {guidelines.trim() && (
              <div style={{ background: "var(--cc-bg)", borderRadius: 10, padding: 14 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Brief</p>
                <p style={{ fontSize: 13, color: "var(--cc-text)", whiteSpace: "pre-wrap" }}>{guidelines.trim()}</p>
              </div>
            )}

            <div style={{ border: "1px solid var(--cc-border)", borderRadius: 10, overflow: "hidden" }}>
              {selectedList.map((c, i) => {
                const rate = typeof c.rate === "number" ? c.rate : 0;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.name}</p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(c.handle)} · {c.platform}</p>
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{rate > 0 ? money(currency, rate) : "No rate"}</p>
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderTop: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
                <p style={{ fontSize: 14, color: "var(--cc-text)" }}>Platform fee</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{money(currency, budgetSummary.platformFee)}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", borderTop: "1px solid var(--cc-border)" }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>Total</p>
                <p style={{ fontSize: 15, fontWeight: 800, color: overBudget ? "var(--cc-danger)" : "var(--cc-text)" }}>{money(currency, budgetSummary.total)}</p>
              </div>
            </div>

            {overBudget && (
              <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 14px", borderRadius: 10, background: "color-mix(in srgb, var(--cc-danger) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--cc-danger) 28%, transparent)" }}>
                <Info size={16} color="var(--cc-danger)" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13, color: "var(--cc-danger)" }}>The total exceeds your budget target. You can still proceed.</span>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 14px", borderRadius: 10, background: "var(--cc-primary-light)" }}>
              <Users size={16} color="var(--cc-primary)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>
                Selected creators are added as pending invites. <strong>Invite &amp; negotiate from the campaign page.</strong>
              </span>
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <div>
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <ChevronLeft size={14} /> Back
              </span>
            </Button>
          )}
        </div>
        <div>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                Next <ChevronRight size={14} />
              </span>
            </Button>
          ) : (
            <Button variant="primary" loading={submitting} disabled={selectedList.length === 0} onClick={handleSubmit}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Check size={14} /> Create campaign
              </span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function RunningTotal({
  currency,
  creatorTotal,
  platformFee,
  total,
  count,
  unpricedCreators,
  budgetTarget,
  overBudget,
  progressPct,
}: {
  currency: Currency;
  creatorTotal: number;
  platformFee: number;
  total: number;
  count: number;
  unpricedCreators: number;
  budgetTarget: number;
  overBudget: boolean;
  progressPct: number;
}) {
  return (
    <div style={{ border: "1px solid var(--cc-border)", borderRadius: 10, padding: 14, background: "var(--cc-bg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
          {count} selected
        </span>
        <Badge variant={overBudget ? "danger" : "accent"}>
          {money(currency, total)}{budgetTarget > 0 ? ` / ${money(currency, budgetTarget)}` : ""}
        </Badge>
      </div>
      {budgetTarget > 0 && (
        <div style={{ height: 8, borderRadius: 4, background: "var(--cc-border)", overflow: "hidden", marginBottom: 8 }}>
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              background: overBudget ? "var(--cc-danger)" : "var(--cc-primary)",
              transition: "width 0.2s",
            }}
          />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--cc-text-muted)" }}>
        <span>Creators {money(currency, creatorTotal)}</span>
        <span>Platform fee {money(currency, platformFee)}</span>
      </div>
      {/* Named rather than absorbed. These creators used to price at zero, so the
          total read as a complete quote while being short by however much they
          eventually cost — on the screen where someone commits a budget. */}
      {unpricedCreators > 0 && (
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 8 }}>
          {unpricedCreators === 1
            ? "1 selected creator has no rate on file, so this total does not include them."
            : `${unpricedCreators} selected creators have no rate on file, so this total does not include them.`}
        </p>
      )}
      {overBudget && (
        <p style={{ fontSize: 12, color: "var(--cc-danger)", marginTop: 8 }}>Over budget target</p>
      )}
    </div>
  );
}
