import { Badge, Card } from "@pratham7711/ui";

export type DeckMetric = { label: string; value: number | string };

export type DeckSection = {
  kind: string;
  title: string;
  narrative: string;
  metrics: DeckMetric[];
};

export type DeckCover = {
  title: string;
  subtitle?: string;
  sectionCount: number;
};

export type Deck = {
  cover: DeckCover;
  sections: DeckSection[];
};

export interface ReportDeckPreviewProps {
  deck: Deck;
}

function pluralizeSections(count: number): string {
  return `${count} ${count === 1 ? "section" : "sections"}`;
}

function formatMetricValue(value: number | string): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
  }
  if (typeof value === "string") return value;
  return "—";
}

export function ReportDeckPreview({ deck }: ReportDeckPreviewProps) {
  const cover = deck?.cover;
  const sections = deck?.sections ?? [];
  const coverTitle = cover?.title ? cover.title : "Untitled deck";
  const coverSubtitle = cover?.subtitle;
  const sectionCount = sections.length;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        data-testid="report-deck-cover"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 16,
          borderRadius: 12,
          border: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Badge variant="neutral">Preview — not exported</Badge>
        </span>
        <span
          data-testid="report-deck-title"
          style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}
        >
          {coverTitle}
        </span>
        {coverSubtitle ? (
          <span
            data-testid="report-deck-subtitle"
            style={{ fontSize: 14, color: "var(--cc-text-muted)" }}
          >
            {coverSubtitle}
          </span>
        ) : null}
        <span
          data-testid="report-deck-section-count"
          style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-subtle)" }}
        >
          {pluralizeSections(sectionCount)}
        </span>
      </div>

      {sectionCount === 0 ? (
        <div
          data-testid="report-deck-empty"
          role="status"
          aria-label="This deck has no sections yet"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 16,
            color: "var(--cc-text-muted)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>This deck has no sections yet</span>
        </div>
      ) : (
        <ul
          data-testid="report-deck-sections"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {sections.map((section, index) => (
            <li key={`${section.kind}-${index}`} data-testid="report-deck-section">
              <Card
                variant="outlined"
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>
                  {section.title}
                </span>
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                  {section.narrative}
                </span>
                {section.metrics && section.metrics.length > 0 ? (
                  <ul
                    data-testid="report-deck-metrics"
                    style={{
                      listStyle: "none",
                      margin: 0,
                      padding: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {section.metrics.map((metric, metricIndex) => (
                      <li
                        key={`${metric.label}-${metricIndex}`}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 8,
                          paddingBottom: 4,
                          borderBottom: "1px solid var(--cc-border)",
                        }}
                      >
                        <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                          {metric.label}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                          {formatMetricValue(metric.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
