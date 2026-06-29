import { Badge, Card } from "@pratham7711/ui";

export interface AuditEvent {
  tool: string;
  orgId: string;
  userId?: string;
  status: string;
  input: unknown;
  output: unknown;
}

export interface AuditEventTimelineProps {
  events: AuditEvent[];
}

type StatusMeta = {
  variant: "success" | "danger" | "warning";
  token: string;
  word: string;
};

const STATUS_META: Record<string, StatusMeta> = {
  ok: { variant: "success", token: "var(--cc-success)", word: "Success" },
  success: { variant: "success", token: "var(--cc-success)", word: "Success" },
  error: { variant: "danger", token: "var(--cc-danger)", word: "Error" },
  failed: { variant: "danger", token: "var(--cc-danger)", word: "Failed" },
  denied: { variant: "danger", token: "var(--cc-danger)", word: "Denied" },
};

const UNKNOWN_STATUS_META: StatusMeta = {
  variant: "warning",
  token: "var(--cc-warning)",
  word: "Unknown",
};

const PREVIEW_LIMIT = 120;

function statusMeta(status: string): StatusMeta {
  if (typeof status !== "string") return UNKNOWN_STATUS_META;
  return STATUS_META[status.toLowerCase()] ?? UNKNOWN_STATUS_META;
}

function actorOf(userId?: string): string {
  if (typeof userId === "string" && userId.length > 0) return userId;
  return "system";
}

function preview(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  let text: string;
  try {
    if (typeof value === "string") {
      text = value;
    } else {
      const serialized = JSON.stringify(value);
      text = typeof serialized === "string" ? serialized : String(value);
    }
  } catch {
    return "(unserializable)";
  }
  if (text.length > PREVIEW_LIMIT) return `${text.slice(0, PREVIEW_LIMIT)}…`;
  return text;
}

export function AuditEventTimeline({ events }: AuditEventTimelineProps) {
  const list = Array.isArray(events) ? events : [];

  if (list.length === 0) {
    return (
      <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          data-testid="audit-timeline-empty"
          role="status"
          aria-label="No audit events recorded"
          style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cc-text-muted)" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>No audit events recorded</span>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ul
        data-testid="audit-timeline"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {list.map((event, index) => {
          const meta = statusMeta(event.status);
          const actor = actorOf(event.userId);
          const inputPreview = preview(event.input);
          const outputPreview = preview(event.output);
          return (
            <li
              key={`${event.tool}-${index}`}
              data-testid="audit-event"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                paddingBottom: 8,
                borderBottom: "1px solid var(--cc-border)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Badge variant={meta.variant} aria-label={`${meta.word} status`}>
                  {meta.word}
                </Badge>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                  {event.tool}
                </span>
                <span
                  data-testid="audit-event-actor"
                  style={{ fontSize: 12, color: "var(--cc-text-muted)" }}
                >
                  {actor}
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>Input</span>
                <span
                  data-testid="audit-event-input"
                  style={{ fontSize: 12, color: "var(--cc-text-muted)", wordBreak: "break-word" }}
                >
                  {inputPreview}
                </span>
                <span style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>Output</span>
                <span
                  data-testid="audit-event-output"
                  style={{ fontSize: 12, color: "var(--cc-text-muted)", wordBreak: "break-word" }}
                >
                  {outputPreview}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
