import React from "react";
import type { LucideIcon } from "lucide-react";
import { MetricHint } from "./MetricHint";
import type { MetricKey } from "@/lib/metric-definitions";

type SectionCardProps = {
  /** A 16px muted mark before the title. Optional: most cards read fine without one. */
  icon?: LucideIcon;
  title: string;
  /** One short line under the title. Methodology belongs in `metric`'s popover, not here. */
  description?: string;
  metric?: MetricKey;
  /** Right of the title: a "View all →" link or one compact outlined button. */
  action?: React.ReactNode;
  /** false for a table or chart that runs to the card's edges. */
  padded?: boolean;
  className?: string;
  id?: string;
  children: React.ReactNode;
};

/**
 * The one titled card.
 *
 * Detail pages and dashboards drew card titles five ways -- a 15px title in a
 * 32px icon chip, 15/700 with no rule, 16/700 with an inline icon, 13/700 --
 * over four card surfaces with insets from 21 to 49px. This is the header they
 * share: an optional 16px muted icon, a 14px semibold title, a hairline, and
 * the body inset by the same 20px as every other card.
 */
export function SectionCard({
  icon: Icon,
  title,
  description,
  metric,
  action,
  padded = true,
  className,
  id,
  children,
}: SectionCardProps) {
  return (
    <section className={`cc-section-card${className ? ` ${className}` : ""}`} id={id}>
      <div className="cc-section-card-head">
        <div className="cc-section-card-heading">
          {Icon ? <Icon aria-hidden="true" className="cc-section-card-icon" strokeWidth={2} /> : null}
          <div className="cc-section-card-headtext">
            <div className="cc-section-card-titlerow">
              <h2 className="cc-section-card-title">{title}</h2>
              {metric ? <MetricHint metric={metric} /> : null}
            </div>
            {description ? <p className="cc-section-card-desc">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="cc-section-card-action">{action}</div> : null}
      </div>
      <div className="cc-section-card-body" data-padded={padded || undefined}>
        {children}
      </div>
    </section>
  );
}
