import React from "react";

export type PageHeaderProps = {
  title: React.ReactNode;
  /** One line under the title. Say what the page counts, not what it is. */
  subtitle?: React.ReactNode;
  /** Buttons, filters — anything right-aligned on the same baseline as the title. */
  actions?: React.ReactNode;
  /** Rendered between the title block and the actions, e.g. a freshness chip. */
  meta?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * The one page header. Before this existed the h1 was re-declared inline on every page
 * and had drifted to three sizes (26/28) and two weights (700/800), which reads as three
 * different products when a client clicks through the nav.
 *
 * Layout lives in `.rsp-header` (globals.css): wraps on narrow viewports and drops the
 * bottom margin from 32 to 24 under 768px.
 */
export function PageHeader({ title, subtitle, actions, meta, className, style }: PageHeaderProps) {
  return (
    <div className={`rsp-header ${className ?? ""}`} style={style}>
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--cc-text)",
            marginBottom: 4,
            // Long campaign and list names are user data: clamp rather than push the
            // action buttons off the row.
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0 }}>{subtitle}</p>
        ) : null}
        {meta}
      </div>
      {actions ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
