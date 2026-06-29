import { Badge, Card } from "@pratham7711/ui";

export interface DiscoveryResultItem {
  id: string;
  name?: string;
  score: number;
  components?: {
    dense: number;
    sparse: number;
  };
  matchedFilters?: string[];
  explanation?: string;
}

export interface DiscoveryResultsProps {
  results: DiscoveryResultItem[];
  emptyLabel?: string;
}

type Tier = {
  variant: "success" | "warning" | "danger";
  token: string;
  label: string;
};

function tierForScore(score: number): Tier {
  const safe = Number.isFinite(score) ? score : 0;
  if (safe >= 80) {
    return { variant: "success", token: "var(--cc-success)", label: "Strong match" };
  }
  if (safe >= 60) {
    return { variant: "warning", token: "var(--cc-warning)", label: "Possible match" };
  }
  return { variant: "danger", token: "var(--cc-danger)", label: "Weak match" };
}

function displayScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(score);
}

export function DiscoveryResults({ results, emptyLabel = "No matching creators" }: DiscoveryResultsProps) {
  if (results.length === 0) {
    return (
      <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          data-testid="discovery-empty"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            fontSize: 14,
            color: "var(--cc-text-muted)",
          }}
        >
          {emptyLabel}
        </div>
      </Card>
    );
  }

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ol
        data-testid="discovery-results"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
      >
        {results.map((result, index) => {
          const rank = index + 1;
          const tier = tierForScore(result.score);
          const score = displayScore(result.score);
          const name = result.name && result.name.length > 0 ? result.name : result.id;
          const filters = result.matchedFilters ?? [];
          return (
            <li
              key={result.id}
              data-testid="discovery-result"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
                padding: 16,
                borderBottom: "1px solid var(--cc-border)",
              }}
            >
              <span
                aria-label={`Rank ${rank}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--cc-bg)",
                  color: "var(--cc-text-muted)",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {rank}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>{name}</span>
                  <span
                    role="img"
                    aria-label={`Match score ${score} of 100`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 8px",
                      borderRadius: 8,
                      border: `1px solid ${tier.token}`,
                      color: tier.token,
                      background: "var(--cc-card)",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {score}
                  </span>
                  <Badge variant={tier.variant}>{tier.label}</Badge>
                </div>
                {result.explanation ? (
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{result.explanation}</span>
                ) : null}
                {filters.length > 0 ? (
                  <div
                    data-testid="discovery-filters"
                    style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                  >
                    {filters.map((filter, filterIndex) => (
                      <Badge key={`${filter}-${filterIndex}`} variant="neutral">
                        {filter}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
