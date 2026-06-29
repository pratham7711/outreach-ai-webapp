import { Badge, Card } from "@pratham7711/ui";

export interface ToolAnnotations {
  permission: string;
  requiresApproval: boolean;
  audit: boolean;
  readOnlyHint: boolean;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  annotations: ToolAnnotations;
}

export interface ToolPermissionsTableProps {
  tools: ToolDescriptor[];
  emptyLabel?: string;
}

type AccessMeta = {
  variant: "danger" | "warning" | "success" | "neutral";
  token: string;
  word: string;
  symbol: string;
};

function accessMeta(annotations: ToolAnnotations): AccessMeta {
  if (annotations.requiresApproval) {
    return {
      variant: "danger",
      token: "var(--cc-danger)",
      word: "Approval required",
      symbol: "!",
    };
  }
  if (annotations.readOnlyHint) {
    return {
      variant: "success",
      token: "var(--cc-success)",
      word: "Read-only",
      symbol: "○",
    };
  }
  return {
    variant: "warning",
    token: "var(--cc-warning)",
    word: "Write",
    symbol: "△",
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

export function ToolPermissionsTable({ tools, emptyLabel }: ToolPermissionsTableProps) {
  const resolvedEmptyLabel = emptyLabel ?? "No tools registered";
  const list = Array.isArray(tools) ? tools : [];

  if (list.length === 0) {
    return (
      <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          data-testid="tools-empty"
          role="status"
          aria-label={resolvedEmptyLabel}
          style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cc-text-muted)" }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>
            ∅
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{resolvedEmptyLabel}</span>
        </div>
      </Card>
    );
  }

  const ordered = list
    .map((tool, index) => ({ tool, index }))
    .sort((a, b) => {
      const nameDiff = a.tool.name.localeCompare(b.tool.name);
      if (nameDiff !== 0) return nameDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.tool);

  const total = safeCount(ordered.length);
  const approvalCount = safeCount(
    ordered.filter((tool) => tool.annotations.requiresApproval).length,
  );

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        data-testid="tools-summary"
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
      >
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
          Tool permissions
        </h4>
        <span
          aria-label={`${total} tools, ${approvalCount} require approval`}
          style={{ fontSize: 12, fontWeight: 500, color: "var(--cc-text-muted)" }}
        >
          {`${total} tools · ${approvalCount} require approval`}
        </span>
      </div>

      <div
        role="table"
        data-testid="tools-table"
        style={{ display: "flex", flexDirection: "column", gap: 0 }}
      >
        <div
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)",
            gap: 8,
            padding: "8px 0",
            borderBottom: "1px solid var(--cc-border)",
          }}
        >
          <span role="columnheader" style={{ fontSize: 11, fontWeight: 700, color: "var(--cc-text-subtle)" }}>
            Tool
          </span>
          <span role="columnheader" style={{ fontSize: 11, fontWeight: 700, color: "var(--cc-text-subtle)" }}>
            Permission
          </span>
          <span role="columnheader" style={{ fontSize: 11, fontWeight: 700, color: "var(--cc-text-subtle)" }}>
            Access
          </span>
          <span role="columnheader" style={{ fontSize: 11, fontWeight: 700, color: "var(--cc-text-subtle)" }}>
            Audit
          </span>
        </div>

        {ordered.map((tool, index) => {
          const meta = accessMeta(tool.annotations);
          const auditWord = tool.annotations.audit ? "Audited" : "Not audited";
          const auditToken = tool.annotations.audit ? "var(--cc-success)" : "var(--cc-text-muted)";
          return (
            <div
              key={`${tool.name}-${index}`}
              role="row"
              data-testid="tools-row"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)",
                gap: 8,
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid var(--cc-border)",
              }}
            >
              <span role="cell" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                  {tool.name}
                </span>
                {tool.description ? (
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {tool.description}
                  </span>
                ) : null}
              </span>
              <span
                role="cell"
                style={{ fontSize: 12, fontWeight: 500, color: "var(--cc-text-muted)" }}
              >
                {tool.annotations.permission}
              </span>
              <span
                role="cell"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span aria-hidden="true" style={{ color: meta.token, fontSize: 12, lineHeight: "16px" }}>
                  {meta.symbol}
                </span>
                <Badge variant={meta.variant} aria-label={`Access: ${meta.word}`}>
                  {meta.word}
                </Badge>
              </span>
              <span
                role="cell"
                aria-label={`Audit: ${auditWord}`}
                style={{ fontSize: 12, fontWeight: 600, color: auditToken }}
              >
                {auditWord}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
