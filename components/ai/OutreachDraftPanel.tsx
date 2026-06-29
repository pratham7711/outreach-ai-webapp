import { Badge, Card } from "@pratham7711/ui";

export interface OutreachGrounding {
  ok: boolean;
  unsupportedNumbers: string[];
}

export interface OutreachDraftPanelProps {
  subject: string;
  body: string;
  groundedFacts: string[];
  grounding?: OutreachGrounding;
  channel?: string;
}

function splitLines(body: string): string[] {
  return body.replace(/\r\n/g, "\n").split("\n");
}

function safeCount(count: number): number {
  if (!Number.isFinite(count)) return 0;
  if (count < 0) return 0;
  return Math.floor(count);
}

export function OutreachDraftPanel({
  subject,
  body,
  groundedFacts,
  grounding,
  channel,
}: OutreachDraftPanelProps) {
  const lines = splitLines(body);
  const hasBody = lines.some((line) => line.trim().length > 0);
  const hasFacts = groundedFacts.length > 0;
  const factCount = safeCount(groundedFacts.length);
  const grounded = grounding ? grounding.ok : null;
  const unsupported = grounding ? grounding.unsupportedNumbers : [];

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        role="note"
        data-testid="draft-only-banner"
        aria-label="Draft only — not sent. Sending requires approval."
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 16,
          borderRadius: 12,
          border: "2px solid var(--cc-warning)",
          background: "var(--cc-card)",
        }}
      >
        <span aria-hidden="true" style={{ color: "var(--cc-warning)", fontSize: 14, fontWeight: 700 }}>
          ⚠
        </span>
        <Badge variant="warning">Draft only</Badge>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
          Draft — not sent. Sending requires approval.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {channel ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            {`Channel: ${channel}`}
          </span>
        ) : null}
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
          {subject}
        </h3>
      </div>

      {hasBody ? (
        <div
          data-testid="draft-body"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {lines.map((line, index) => (
            <p
              key={`line-${index}`}
              style={{ fontSize: 14, lineHeight: "22px", color: "var(--cc-text)", margin: 0, minHeight: 8 }}
            >
              {line}
            </p>
          ))}
        </div>
      ) : (
        <p
          role="status"
          data-testid="draft-body-empty"
          style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}
        >
          No draft body yet.
        </p>
      )}

      {grounding ? (
        grounded ? (
          <div
            data-testid="grounding-ok"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 16,
              borderRadius: 12,
              border: "2px solid var(--cc-success)",
              background: "var(--cc-card)",
            }}
          >
            <span aria-hidden="true" style={{ color: "var(--cc-success)", fontSize: 12 }}>
              ✓
            </span>
            <span
              aria-label={`Grounded in ${factCount} facts`}
              style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}
            >
              {`Grounded in ${factCount} facts`}
            </span>
          </div>
        ) : (
          <div
            data-testid="grounding-warning"
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
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-danger)", margin: 0 }}>
              {`${unsupported.length} unsupported claim(s)`}
            </h4>
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
              These numbers are not backed by the supplied evidence and must be removed before approval.
            </p>
            {unsupported.length > 0 ? (
              <ul
                data-testid="unsupported-list"
                style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8 }}
              >
                {unsupported.map((token, index) => (
                  <li
                    key={`unsupported-${index}`}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span aria-hidden="true" style={{ color: "var(--cc-danger)", fontSize: 12 }}>
                      ✕
                    </span>
                    <span
                      aria-label={`Unsupported number ${token}`}
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}
                    >
                      {token}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
          Grounded in
        </h4>
        {hasFacts ? (
          <ul
            data-testid="grounded-facts"
            style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
          >
            {groundedFacts.map((fact, index) => (
              <li
                key={`fact-${index}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--cc-border)",
                }}
              >
                <span aria-hidden="true" style={{ color: "var(--cc-success)", fontSize: 12, lineHeight: "18px" }}>
                  •
                </span>
                <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{fact}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p
            role="status"
            data-testid="grounded-facts-empty"
            style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}
          >
            No grounding facts attached to this draft.
          </p>
        )}
      </div>

      <div
        data-testid="approval-gate"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: 16,
          borderRadius: 12,
          border: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
        }}
      >
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="send-affordance"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 16px",
            borderRadius: 8,
            border: "1px solid var(--cc-border)",
            background: "var(--cc-bg)",
            color: "var(--cc-text-muted)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "not-allowed",
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--cc-text-muted)", fontSize: 12 }}>
            🔒
          </span>
          Requires approval
        </button>
        <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
          A human must approve this draft before it can be sent.
        </span>
      </div>
    </Card>
  );
}
