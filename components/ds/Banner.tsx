import React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";

export type BannerTone = "info" | "warning" | "danger" | "success";

export type BannerProps = {
  /** `info` is a neutral ink tint; the other three are the status hues, used for status only. */
  tone?: BannerTone;
  /** Replaces the tone's glyph. `false` draws no icon. */
  icon?: React.ReactNode | false;
  /** An optional bold lead-in, run into the message on the same line. */
  title?: React.ReactNode;
  children: React.ReactNode;
  /** One small button or link, pushed to the right edge. */
  action?: React.ReactNode;
  /**
   * `page`: a rounded box in the content column, between the header and the
   * content. `shell`: a full-width strip under the top bar, inset by the page
   * gutter so its icon lines up with the breadcrumb and the title. `inline`: a
   * note inside a card, a size down.
   */
  placement?: "page" | "shell" | "inline";
  /** `status` for a notice; `alert` only for something the reader must act on now. */
  role?: "status" | "alert";
  className?: string;
  style?: React.CSSProperties;
};

const TONE_ICON: Record<BannerTone, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  danger: OctagonAlert,
  success: CheckCircle2,
};

/**
 * The one notice strip. Colour, border, radius and spacing come from
 * `.cc-banner` in globals.css, keyed by `data-tone` and `data-placement`, so
 * every banner on the site changes together.
 */
export function Banner({
  tone = "info",
  icon,
  title,
  children,
  action,
  placement = "page",
  role = "status",
  className,
  style,
}: BannerProps) {
  const Glyph = TONE_ICON[tone];
  return (
    <div
      role={role}
      className={`cc-banner${className ? ` ${className}` : ""}`}
      data-tone={tone}
      data-placement={placement}
      style={style}
    >
      {icon === false ? null : (
        <span className="cc-banner-icon" aria-hidden="true">
          {icon ?? <Glyph aria-hidden="true" />}
        </span>
      )}
      <div className="cc-banner-text">
        {title ? <strong className="cc-banner-title">{title}</strong> : null}
        {title ? " " : null}
        {children}
      </div>
      {action ? <div className="cc-banner-action">{action}</div> : null}
    </div>
  );
}
