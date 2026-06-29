import { Badge, Card } from "@pratham7711/ui";

export type RateBand = "below" | "fair" | "above";

export interface RateBenchmarkFactor {
  label: string;
  impact: number;
  detail?: string;
}

export interface RateCardBenchmarkProps {
  rate: number;
  percentile: number;
  band: RateBand;
  median: number;
  suggestedRange: { low: number; high: number };
  currency?: string;
  factors?: RateBenchmarkFactor[];
}

type BandMeta = {
  variant: "success" | "warning" | "danger";
  token: string;
  word: string;
  symbol: string;
};

const BAND_META: Record<RateBand, BandMeta> = {
  below: { variant: "warning", token: "var(--cc-warning)", word: "Below market", symbol: "▼" },
  fair: { variant: "success", token: "var(--cc-success)", word: "Fair", symbol: "●" },
  above: { variant: "danger", token: "var(--cc-danger)", word: "Above market", symbol: "▲" },
};

function safeNum(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function safePercentile(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function safeImpact(impact: number): number {
  return Number.isFinite(impact) ? impact : 0;
}

function formatMoney(currency: string, value: number): string {
  return `${currency}${safeNum(value).toLocaleString("en-US")}`;
}

function ordinalSuffix(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return "th";
  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function RateCardBenchmark({
  rate,
  percentile,
  band,
  median,
  suggestedRange,
  currency = "$",
  factors,
}: RateCardBenchmarkProps) {
  const meta = BAND_META[band] ?? BAND_META.fair;
  const pct = safePercentile(percentile);
  const safeRate = safeNum(rate);
  const safeMedian = safeNum(median);
  const range = suggestedRange ?? { low: 0, high: 0 };
  const rawLow = safeNum(range.low);
  const rawHigh = safeNum(range.high);
  const low = Math.min(rawLow, rawHigh);
  const high = Math.max(rawLow, rawHigh);
  const factorList = factors ?? [];
  const hasFactors = factorList.length > 0;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>
            Creator rate
          </span>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)" }}>
            {formatMoney(currency, safeRate)}
          </span>
        </div>
        <div
          data-testid="rate-band"
          aria-label={`Rate benchmark verdict: ${meta.word}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 12,
            border: `2px solid ${meta.token}`,
            background: "var(--cc-card)",
          }}
        >
          <span aria-hidden="true" style={{ color: meta.token, fontSize: 12, lineHeight: "16px" }}>
            {meta.symbol}
          </span>
          <Badge variant={meta.variant}>{meta.word}</Badge>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span
          data-testid="rate-percentile"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}
        >
          {`${pct}${ordinalSuffix(pct)} percentile vs peers`}
        </span>
        <div
          role="img"
          aria-label={`${pct} of 100 percentile`}
          style={{
            position: "relative",
            height: 8,
            borderRadius: 8,
            background: "var(--cc-border)",
            overflow: "hidden",
          }}
        >
          <div
            data-testid="rate-percentile-bar"
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 8,
              background: meta.token,
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          padding: 16,
          borderRadius: 12,
          border: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>
            Peer median
          </span>
          <span
            data-testid="rate-median"
            style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)" }}
          >
            {formatMoney(currency, safeMedian)}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>
            Suggested range
          </span>
          <span
            data-testid="rate-suggested-range"
            style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)" }}
          >
            {`${formatMoney(currency, low)}–${formatMoney(currency, high)}`}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
          What drives this benchmark
        </h4>
        {hasFactors ? (
          <ul
            data-testid="rate-factors"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {factorList.map((factor, index) => {
              const impact = safeImpact(factor.impact);
              const positive = impact >= 0;
              const directionToken = positive ? "var(--cc-success)" : "var(--cc-danger)";
              const directionSymbol = positive ? "▲" : "▼";
              const directionWord = positive ? "Pushes up" : "Pushes down";
              return (
                <li
                  key={`${factor.label}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--cc-border)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: directionToken, fontSize: 12, lineHeight: "18px" }}
                  >
                    {directionSymbol}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      {factor.label}
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--cc-text-muted)",
                        }}
                      >
                        {directionWord} ({positive ? "+" : ""}
                        {impact})
                      </span>
                    </span>
                    {factor.detail ? (
                      <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                        {factor.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p
            role="status"
            data-testid="rate-factors-empty"
            style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}
          >
            No benchmark factors available.
          </p>
        )}
      </div>
    </Card>
  );
}
