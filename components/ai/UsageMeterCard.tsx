import { Badge, Card } from "@pratham7711/ui";

export interface UsageTotals {
  totalTokens: number;
  totalCostUsd: number;
  runs: number;
  byTool: Record<string, { tokens: number; costUsd: number; runs: number }>;
}

export interface UsageLimits {
  maxTokens?: number;
  maxCostUsd?: number;
  maxRuns?: number;
}

export interface UsageEntitlement {
  allowed: boolean;
  exceeded: string[];
  remaining: { tokens?: number; costUsd?: number; runs?: number };
}

export interface UsageMeterCardProps {
  usage: UsageTotals;
  limits?: UsageLimits;
  entitlement?: UsageEntitlement;
  currency?: string;
}

type MetricKind = "tokens" | "cost" | "runs";

function safeNum(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value;
}

function clampPercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  const pct = (used / limit) * 100;
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function formatTokens(value: number): string {
  return safeNum(value).toLocaleString("en-US");
}

function formatMoney(currency: string, value: number): string {
  const amount = safeNum(value);
  const rounded = Math.round(amount * 100) / 100;
  return `${currency}${rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const EXCEEDED_LABEL: Record<string, string> = {
  tokens: "tokens",
  cost: "cost",
  costUsd: "cost",
  runs: "runs",
};

const METRIC_TITLE: Record<MetricKind, string> = {
  tokens: "Tokens",
  cost: "Cost",
  runs: "Runs",
};

function isExceeded(entitlement: UsageEntitlement | undefined, keys: string[]): boolean {
  if (!entitlement) return false;
  const list = Array.isArray(entitlement.exceeded) ? entitlement.exceeded : [];
  return list.some((dimension) => keys.includes(dimension));
}

export function UsageMeterCard({
  usage,
  limits,
  entitlement,
  currency = "$",
}: UsageMeterCardProps) {
  const tokens = safeNum(usage?.totalTokens);
  const cost = safeNum(usage?.totalCostUsd);
  const runs = safeNum(usage?.runs);
  const byTool = usage?.byTool ?? {};
  const toolNames = Object.keys(byTool);
  const hasTools = toolNames.length > 0;

  const maxTokens = limits?.maxTokens;
  const maxCostUsd = limits?.maxCostUsd;
  const maxRuns = limits?.maxRuns;

  const metrics: Array<{
    kind: MetricKind;
    usedText: string;
    limitText: string | null;
    percent: number;
    testid: string;
    exceededKeys: string[];
  }> = [
    {
      kind: "tokens",
      usedText: formatTokens(tokens),
      limitText:
        typeof maxTokens === "number" && Number.isFinite(maxTokens)
          ? formatTokens(maxTokens)
          : null,
      percent: clampPercent(tokens, safeNum(maxTokens)),
      testid: "usage-metric-tokens",
      exceededKeys: ["tokens"],
    },
    {
      kind: "cost",
      usedText: formatMoney(currency, cost),
      limitText:
        typeof maxCostUsd === "number" && Number.isFinite(maxCostUsd)
          ? formatMoney(currency, maxCostUsd)
          : null,
      percent: clampPercent(cost, safeNum(maxCostUsd)),
      testid: "usage-metric-cost",
      exceededKeys: ["cost", "costUsd"],
    },
    {
      kind: "runs",
      usedText: formatTokens(runs),
      limitText:
        typeof maxRuns === "number" && Number.isFinite(maxRuns)
          ? formatTokens(maxRuns)
          : null,
      percent: clampPercent(runs, safeNum(maxRuns)),
      testid: "usage-metric-runs",
      exceededKeys: ["runs"],
    },
  ];

  const exceededNames = entitlement
    ? (Array.isArray(entitlement.exceeded) ? entitlement.exceeded : [])
        .map((dimension) => EXCEEDED_LABEL[dimension] ?? dimension)
        .filter((name) => name.length > 0)
    : [];

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
          Usage this period
        </h3>
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          Tokens, cost, and runs across AI tools
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {metrics.map((metric) => {
          const over = isExceeded(entitlement, metric.exceededKeys);
          const barToken = over ? "var(--cc-danger)" : "var(--cc-primary)";
          const valueText = metric.limitText
            ? `${metric.usedText} / ${metric.limitText}`
            : metric.usedText;
          return (
            <div
              key={metric.kind}
              data-testid={metric.testid}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>
                  {METRIC_TITLE[metric.kind]}
                  {over ? (
                    <span
                      data-testid={`${metric.testid}-overlimit`}
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--cc-danger)",
                      }}
                    >
                      Over limit
                    </span>
                  ) : null}
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>
                  {valueText}
                </span>
              </div>
              {metric.limitText ? (
                <div
                  role="img"
                  aria-label={`${METRIC_TITLE[metric.kind]} ${metric.usedText} of ${metric.limitText}`}
                  style={{
                    position: "relative",
                    height: 8,
                    borderRadius: 8,
                    background: "var(--cc-border)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    data-testid={`${metric.testid}-bar`}
                    style={{
                      width: `${metric.percent}%`,
                      height: "100%",
                      borderRadius: 8,
                      background: barToken,
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {entitlement ? (
        entitlement.allowed ? (
          <div
            data-testid="usage-within-limits"
            role="status"
            aria-label="Within limits"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 12,
              border: "2px solid var(--cc-success)",
              background: "var(--cc-card)",
            }}
          >
            <span aria-hidden="true" style={{ color: "var(--cc-success)", fontSize: 14, lineHeight: "18px" }}>
              ✓
            </span>
            <Badge variant="success">Within limits</Badge>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
              Within limits
            </span>
          </div>
        ) : (
          <div
            data-testid="usage-blocked"
            role="status"
            aria-label="Usage blocked: over limit"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 16,
              borderRadius: 12,
              border: "2px solid var(--cc-danger)",
              background: "var(--cc-card)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true" style={{ color: "var(--cc-danger)", fontSize: 14, lineHeight: "18px" }}>
                ✕
              </span>
              <Badge variant="danger">Blocked</Badge>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-danger)" }}>
              {exceededNames.length > 0
                ? `Over limit: ${exceededNames.join(", ")}`
                : "Over limit"}
            </span>
          </div>
        )
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
          Breakdown by tool
        </h4>
        {hasTools ? (
          <ul
            data-testid="usage-by-tool"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {toolNames.map((toolName) => {
              const entry = byTool[toolName] ?? { tokens: 0, costUsd: 0, runs: 0 };
              return (
                <li
                  key={toolName}
                  data-testid="usage-tool-row"
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
                    {toolName}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {`${formatTokens(safeNum(entry.tokens))} tokens · ${formatMoney(
                      currency,
                      safeNum(entry.costUsd),
                    )} · ${formatTokens(safeNum(entry.runs))} runs`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p
            role="status"
            data-testid="usage-empty"
            aria-label="No tool usage recorded"
            style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}
          >
            No tool usage recorded.
          </p>
        )}
      </div>
    </Card>
  );
}
