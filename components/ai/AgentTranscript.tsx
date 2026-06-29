import { Badge, Card } from "@pratham7711/ui";

export type AgentTranscriptRole = "user" | "assistant" | "tool";

export type AgentTranscriptKind =
  | "message"
  | "tool_use"
  | "tool_result"
  | "awaiting_approval";

export type AgentTranscriptStatus = "ok" | "error" | "pending";

export interface AgentTranscriptStep {
  id: string;
  role: AgentTranscriptRole;
  kind: AgentTranscriptKind;
  text?: string;
  toolName?: string;
  status?: AgentTranscriptStatus;
}

export interface AgentTranscriptProps {
  steps: AgentTranscriptStep[];
  title?: string;
  emptyLabel?: string;
}

type RoleMeta = {
  word: string;
};

const ROLE_META: Record<AgentTranscriptRole, RoleMeta> = {
  user: { word: "You" },
  assistant: { word: "Agent" },
  tool: { word: "Tool" },
};

type StatusMeta = {
  variant: "success" | "danger" | "warning";
  word: string;
};

const STATUS_META: Record<AgentTranscriptStatus, StatusMeta> = {
  ok: { variant: "success", word: "OK" },
  error: { variant: "danger", word: "Error" },
  pending: { variant: "warning", word: "Pending" },
};

function safeText(value: string | undefined): string {
  return typeof value === "string" ? value : "";
}

function safeToolName(value: string | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "tool";
}

function roleLabel(step: AgentTranscriptStep): string {
  if (step.role === "tool") {
    return `Tool: ${safeToolName(step.toolName)}`;
  }
  return ROLE_META[step.role].word;
}

function renderLines(text: string) {
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <span key={index} style={{ display: "block" }}>
      {line.length > 0 ? line : " "}
    </span>
  ));
}

export function AgentTranscript({ steps, title, emptyLabel }: AgentTranscriptProps) {
  const heading = title && title.length > 0 ? title : "Agent run";
  const empty = emptyLabel && emptyLabel.length > 0 ? emptyLabel : "No agent activity yet";
  const list = Array.isArray(steps) ? steps : [];
  const hasSteps = list.length > 0;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)" }}>
          Transcript
        </span>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
          {heading}
        </h2>
      </div>

      {hasSteps ? (
        <ol
          data-testid="transcript-steps"
          aria-label="Agent transcript steps"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {list.map((step, index) => {
            const label = roleLabel(step);
            const text = safeText(step.text);
            const isAwaiting = step.kind === "awaiting_approval";
            const isToolUse = step.kind === "tool_use";
            const isToolResult = step.kind === "tool_result";
            const statusMeta = step.status ? STATUS_META[step.status] : undefined;

            return (
              <li
                key={`${step.id}-${index}`}
                data-testid="transcript-step"
                data-kind={step.kind}
                aria-label={`${label}, ${step.kind.replace("_", " ")}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: 12,
                  borderRadius: 8,
                  border: isAwaiting ? "2px solid var(--cc-warning)" : "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: "var(--cc-text-muted)",
                  }}
                >
                  {label}
                </span>

                {isToolUse ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                    {`Tool: ${safeToolName(step.toolName)}`}
                  </span>
                ) : null}

                {isToolResult ? (
                  <span
                    data-testid="transcript-status"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    <Badge variant={statusMeta ? statusMeta.variant : "warning"}>
                      {statusMeta ? statusMeta.word : "Pending"}
                    </Badge>
                  </span>
                ) : null}

                {isAwaiting ? (
                  <span
                    data-testid="awaiting-approval"
                    role="status"
                    aria-label="Awaiting approval"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      alignSelf: "flex-start",
                      gap: 8,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "2px solid var(--cc-warning)",
                      background: "var(--cc-bg)",
                      color: "var(--cc-text)",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Awaiting approval
                  </span>
                ) : null}

                {text.length > 0 ? (
                  <div
                    data-testid="transcript-text"
                    style={{ fontSize: 13, color: "var(--cc-text)" }}
                  >
                    {renderLines(text)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div
          data-testid="transcript-empty"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            borderRadius: 12,
            border: "1px dashed var(--cc-border)",
            background: "var(--cc-card)",
            color: "var(--cc-text-muted)",
            fontSize: 13,
          }}
        >
          {empty}
        </div>
      )}
    </Card>
  );
}
