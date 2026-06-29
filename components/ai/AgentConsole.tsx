import { Badge, Card } from "@pratham7711/ui";

export type AgentStatus = "completed" | "awaiting_approval" | "max_steps";

export interface AgentTranscriptEntry {
  role: string;
  text: string;
}

export interface AgentConsoleResult {
  status: AgentStatus;
  finalText?: string;
  pendingApproval?: { tool: string; input: unknown };
}

export interface AgentConsoleProps {
  goal: string;
  result: AgentConsoleResult;
  transcript?: AgentTranscriptEntry[];
}

type StatusMeta = {
  variant: "success" | "warning" | "danger";
  label: string;
};

const STATUS_META: Record<AgentStatus, StatusMeta> = {
  completed: { variant: "success", label: "Completed" },
  awaiting_approval: { variant: "warning", label: "Awaiting approval" },
  max_steps: { variant: "danger", label: "Reached step limit" },
};

function renderInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function AgentConsole({ goal, result, transcript }: AgentConsoleProps) {
  const meta = STATUS_META[result.status];
  const hasTranscript = Array.isArray(transcript) && transcript.length > 0;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>Agent goal</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{goal}</h2>
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {hasTranscript ? (
        <ol
          data-testid="agent-transcript"
          aria-label="Agent transcript"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
        >
          {transcript.map((entry, index) => (
            <li
              key={`${entry.role}-${index}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: 8,
                borderRadius: 8,
                border: "1px solid var(--cc-border)",
                background: "var(--cc-card)",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--cc-text-muted)" }}>
                {entry.role}
              </span>
              <span style={{ fontSize: 13, color: "var(--cc-text)", whiteSpace: "pre-wrap" }}>{entry.text}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {result.finalText ? (
        <p data-testid="agent-final-text" style={{ fontSize: 14, color: "var(--cc-text)", margin: 0, whiteSpace: "pre-wrap" }}>
          {result.finalText}
        </p>
      ) : null}

      {result.status === "awaiting_approval" ? (
        <section
          data-testid="approval-panel"
          role="region"
          aria-label="Human approval required"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            borderRadius: 12,
            border: "2px solid var(--cc-warning)",
            background: "var(--cc-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge variant="warning">Approval required</Badge>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
              {result.pendingApproval ? result.pendingApproval.tool : "Pending action"}
            </span>
          </div>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
            This write or financial action needs a human to approve before it runs.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>Requested input</span>
            <pre
              data-testid="approval-input"
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                border: "1px solid var(--cc-border)",
                background: "var(--cc-bg)",
                color: "var(--cc-text)",
                fontSize: 12,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {renderInput(result.pendingApproval ? result.pendingApproval.input : null)}
            </pre>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span
              role="button"
              aria-label="Approve pending action"
              aria-disabled="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--cc-primary)",
                background: "var(--cc-primary)",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Approve
            </span>
            <span
              role="button"
              aria-label="Reject pending action"
              aria-disabled="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--cc-danger)",
                background: "var(--cc-card)",
                color: "var(--cc-danger)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Reject
            </span>
          </div>
        </section>
      ) : null}

      {result.status === "max_steps" ? (
        <div
          data-testid="max-steps-notice"
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--cc-danger)",
            background: "var(--cc-card)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-danger)" }}>Reached step limit</span>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            The agent stopped after hitting the maximum number of steps without finishing the goal.
          </span>
        </div>
      ) : null}
    </Card>
  );
}
