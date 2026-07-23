import { Badge, Card } from "@pratham7711/ui";
import { CheckCircle2, XCircle } from "lucide-react";

export interface ContractDeliverable {
  kind: string;
  quantity: number;
}

export interface ContractSchedule {
  startEpochMs: number;
  endEpochMs: number;
}

export interface ContractTerms {
  deliverables: ContractDeliverable[];
  rateUsd: number;
  schedule: ContractSchedule;
  usageRights?: string;
  exclusivityDays?: number;
}

export type ContractIssueSeverity = "error" | "warning";

export interface ContractIssue {
  code: string;
  severity: ContractIssueSeverity;
  detail: string;
}

export interface ContractValidationResult {
  valid: boolean;
  issues: ContractIssue[];
}

export interface ContractTermsReviewProps {
  terms: ContractTerms;
  validation: ContractValidationResult;
  summary?: string;
  currency?: string;
}

const MS_PER_DAY = 86_400_000;

type SeverityMeta = {
  variant: "danger" | "warning";
  word: string;
  rank: number;
};

const SEVERITY_META: Record<ContractIssueSeverity, SeverityMeta> = {
  error: { variant: "danger", word: "Error", rank: 0 },
  warning: { variant: "warning", word: "Warning", rank: 1 },
};

const CODE_LABEL: Record<string, string> = {
  NO_DELIVERABLES: "No deliverable with a positive quantity",
  INVALID_RATE: "Rate must be greater than zero",
  INVALID_SCHEDULE: "Invalid schedule window",
  NEGATIVE_EXCLUSIVITY: "Exclusivity period is negative",
  VERY_LONG_EXCLUSIVITY: "Exclusivity period is unusually long",
  MISSING_USAGE_RIGHTS: "Usage rights not specified",
};

function safeNum(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value;
}

function severityMeta(severity: ContractIssueSeverity): SeverityMeta {
  return SEVERITY_META[severity] ?? SEVERITY_META.warning;
}

function labelForCode(code: string): string {
  return CODE_LABEL[code] ?? code;
}

function formatMoney(currency: string, value: number): string {
  const amount = safeNum(value);
  const rounded = Math.round(amount * 100) / 100;
  return `${currency}${rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function scheduleDays(schedule: ContractSchedule | undefined): number {
  const start = schedule?.startEpochMs;
  const end = schedule?.endEpochMs;
  if (typeof start !== "number" || !Number.isFinite(start)) return 0;
  if (typeof end !== "number" || !Number.isFinite(end)) return 0;
  const diff = (end - start) / MS_PER_DAY;
  if (!Number.isFinite(diff) || diff < 0) return 0;
  return Math.round(diff);
}

export function ContractTermsReview({
  terms,
  validation,
  summary,
  currency = "$",
}: ContractTermsReviewProps) {
  const valid = validation?.valid === true;
  const verdictWord = valid ? "Valid" : "Not valid";
  const verdictVariant = valid ? "success" : "danger";
  const verdictToken = valid ? "var(--cc-success)" : "var(--cc-danger)";

  const deliverables = Array.isArray(terms?.deliverables) ? terms.deliverables : [];
  const rateText = formatMoney(currency, terms?.rateUsd ?? 0);
  const days = scheduleDays(terms?.schedule);
  const dayWord = days === 1 ? "day" : "days";
  const usageRightsText =
    typeof terms?.usageRights === "string" && terms.usageRights.trim().length > 0
      ? terms.usageRights.trim()
      : "Not specified";
  const exclusivityDays = safeNum(terms?.exclusivityDays);
  const exclusivityWord = exclusivityDays === 1 ? "day" : "days";

  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const ordered = issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      const rankDiff = severityMeta(a.issue.severity).rank - severityMeta(b.issue.severity).rank;
      if (rankDiff !== 0) return rankDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.issue);

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        data-testid="contract-verdict"
        aria-label={`Contract terms ${verdictWord}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: 16,
          borderRadius: 12,
          border: `2px solid ${verdictToken}`,
          background: "var(--cc-card)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            Contract terms review
          </h3>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Review the proposed terms before approval
          </span>
        </div>
        <Badge variant={verdictVariant} aria-label={`Validation verdict: ${verdictWord}`}>
          {verdictWord}
        </Badge>
      </div>

      {valid ? null : (
        <div
          data-testid="contract-cannot-proceed"
          role="status"
          aria-label="Cannot proceed: resolve errors before approval"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 12,
            border: "2px solid var(--cc-danger)",
            background: "var(--cc-card)",
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--cc-danger)", fontSize: 14, lineHeight: "18px" }}>
            <XCircle size={14} color="var(--cc-danger)" />
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-danger)" }}>
            Cannot proceed — resolve errors
          </span>
        </div>
      )}

      {typeof summary === "string" && summary.trim().length > 0 ? (
        <p
          data-testid="contract-summary"
          style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}
        >
          {summary}
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
          Deliverables
        </h4>
        {deliverables.length > 0 ? (
          <ul
            data-testid="contract-deliverables"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {deliverables.map((deliverable, index) => (
              <li
                key={`${deliverable.kind}-${index}`}
                data-testid="contract-deliverable-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--cc-border)",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                  {deliverable.kind}
                </span>
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                  {`${deliverable.kind} × ${safeNum(deliverable.quantity).toLocaleString("en-US")}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p
            data-testid="contract-deliverables-empty"
            role="status"
            aria-label="No deliverables listed"
            style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}
          >
            No deliverables listed.
          </p>
        )}
      </div>

      <dl
        data-testid="contract-meta"
        style={{
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>Rate</dt>
          <dd
            data-testid="contract-rate"
            style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}
          >
            {rateText}
          </dd>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>Schedule</dt>
          <dd
            data-testid="contract-schedule"
            style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}
          >
            {`${days.toLocaleString("en-US")} ${dayWord}`}
          </dd>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>Usage rights</dt>
          <dd
            data-testid="contract-usage-rights"
            style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}
          >
            {usageRightsText}
          </dd>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <dt style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>Exclusivity</dt>
          <dd
            data-testid="contract-exclusivity"
            style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}
          >
            {`${exclusivityDays.toLocaleString("en-US")} ${exclusivityWord}`}
          </dd>
        </div>
      </dl>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
          Validation issues
        </h4>
        {ordered.length > 0 ? (
          <ul
            data-testid="contract-issues"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {ordered.map((issue, index) => {
              const meta = severityMeta(issue.severity);
              return (
                <li
                  key={`${issue.code}-${index}`}
                  data-testid="contract-issue-row"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--cc-border)",
                  }}
                >
                  <Badge variant={meta.variant} aria-label={`${meta.word} severity`}>
                    {meta.word}
                  </Badge>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      {labelForCode(issue.code)}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{issue.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p
            data-testid="issues-clean"
            role="status"
            aria-label="No validation issues"
            style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cc-success)", margin: 0 }}
          >
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>
              <CheckCircle2 size={16} color="var(--cc-success)" />
            </span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>No validation issues.</span>
          </p>
        )}
      </div>

      <div
        data-testid="contract-unsigned-banner"
        role="note"
        aria-label="Draft, not signed. E-signature requires approval."
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: 16,
          borderRadius: 12,
          border: "2px dashed var(--cc-border)",
          background: "var(--cc-card)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>
          Draft — Not signed
        </span>
        <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
          This is a display-only review. E-signature requires approval and cannot happen here.
        </span>
      </div>
    </Card>
  );
}
