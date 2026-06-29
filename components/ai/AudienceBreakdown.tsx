import { Badge, Card } from "@pratham7711/ui";

type Confidence = "low" | "medium" | "high";

export interface AudienceBreakdownEntry {
  key: string;
  share: number;
}

export interface AudienceBreakdownQuality {
  confidence: Confidence;
  flags: string[];
}

export interface AudienceBreakdownProps {
  estimate: {
    geo: AudienceBreakdownEntry[];
    age: AudienceBreakdownEntry[];
    interests: AudienceBreakdownEntry[];
    quality: AudienceBreakdownQuality;
  };
  topN?: number;
}

type Section = {
  id: string;
  title: string;
  distribution: AudienceBreakdownEntry[];
};

const DEFAULT_TOP_N = 5;

const CONFIDENCE_VARIANT: Record<Confidence, "success" | "warning" | "danger"> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

const FLAG_LABEL: Record<string, string> = {
  LOW_SAMPLE: "Low sample size",
  GEO_CONCENTRATION: "Geographic concentration",
  SPARSE_INTERESTS: "Sparse interests",
};

function flagLabel(flag: string): string {
  return FLAG_LABEL[flag] ?? flag;
}

function clampWidth(share: number): number {
  if (typeof share !== "number" || !Number.isFinite(share)) {
    return 0;
  }
  const pct = share * 100;
  if (pct <= 0) {
    return 0;
  }
  if (pct >= 100) {
    return 100;
  }
  return pct;
}

function percentText(pct: number): string {
  return `${Math.round(pct)}%`;
}

function resolveTopN(topN: number | undefined): number {
  if (typeof topN !== "number" || !Number.isFinite(topN) || topN <= 0) {
    return DEFAULT_TOP_N;
  }
  return Math.floor(topN);
}

export function AudienceBreakdown({ estimate, topN }: AudienceBreakdownProps) {
  const limit = resolveTopN(topN);
  const confidence = estimate.quality.confidence;
  const flags = estimate.quality.flags;

  const sections: Section[] = [
    { id: "geo", title: "Geography", distribution: estimate.geo },
    { id: "age", title: "Age", distribution: estimate.age },
    { id: "interests", title: "Interests", distribution: estimate.interests },
  ];

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge variant={CONFIDENCE_VARIANT[confidence]}>{CONFIDENCE_LABEL[confidence]}</Badge>
        {flags.length > 0 ? (
          <div
            data-testid="audience-flags"
            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            {flags.map((flag) => (
              <span
                key={flag}
                data-testid={`audience-flag-${flag}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  borderRadius: 8,
                  border: "1px solid var(--cc-warning)",
                  color: "var(--cc-warning)",
                  background: "var(--cc-card)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {flagLabel(flag)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {sections.map((section) => {
        const rows = section.distribution.slice(0, limit);
        return (
          <div
            key={section.id}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
              {section.title}
            </h4>
            {rows.length === 0 ? (
              <p
                data-testid={`audience-${section.id}-empty`}
                style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}
              >
                No data
              </p>
            ) : (
              <ul
                data-testid={`audience-${section.id}-rows`}
                style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
              >
                {rows.map((entry, index) => {
                  const width = clampWidth(entry.share);
                  const label = `${entry.key} ${Math.round(width)} percent`;
                  return (
                    <li
                      key={`${entry.key}-${index}`}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <span
                        style={{
                          flex: "0 0 auto",
                          minWidth: 96,
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--cc-text)",
                        }}
                      >
                        {entry.key}
                      </span>
                      <span
                        role="img"
                        aria-label={label}
                        style={{
                          flex: 1,
                          display: "block",
                          height: 8,
                          borderRadius: 8,
                          background: "var(--cc-border)",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${width}%`,
                            background: "var(--cc-primary)",
                            borderRadius: 8,
                          }}
                        />
                      </span>
                      <span
                        style={{
                          flex: "0 0 auto",
                          minWidth: 40,
                          textAlign: "right",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--cc-text-muted)",
                        }}
                      >
                        {percentText(width)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </Card>
  );
}
