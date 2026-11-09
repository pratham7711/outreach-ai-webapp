"use client";
import { Hammer, Lock, AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Banner, type BannerTone } from "./Banner";

/**
 * Three states that are routinely collapsed into one "coming soon", and must not be.
 *
 * They differ in who can act and what happens next:
 *   not-built   nobody can do anything; the answer is "wait"
 *   locked      an administrator can act; the answer is "upgrade or ask"
 *   degraded    we are already acting; the answer is "it will fix itself"
 *
 * A user told "coming soon" for something that is actually an outage will not
 * report it. One told "coming soon" for something their plan could unlock will
 * not buy it. Conflating them costs a bug report and a sale respectively, so
 * each gets its own icon, its own tone and its own verb.
 *
 * A note on the locked variant: it takes an `action` rather than assuming a
 * Billing link, because the audit found lock screens telling users to "enable
 * it in Billing" when nothing in the app can write org features. Never point a
 * lock at a door with no handle — if there is no way to self-serve, the honest
 * action is "contact support".
 *
 * Drawn as the shared Banner in its tone (the neutral ink tint for not-built,
 * warning for the other two) rather than a card with a 3px coloured left
 * stripe; the icon stays per kind.
 */

export type FeatureStateKind = "not-built" | "locked" | "degraded";

const PRESET: Record<FeatureStateKind, { Icon: LucideIcon; tone: BannerTone }> = {
  "not-built": { Icon: Hammer, tone: "info" },
  locked: { Icon: Lock, tone: "warning" },
  degraded: { Icon: AlertTriangle, tone: "warning" },
};

export function FeatureState({
  kind,
  title,
  body,
  action,
  footnote,
}: {
  kind: FeatureStateKind;
  title: string;
  body: string;
  action?: ReactNode;
  footnote?: string;
}) {
  const { Icon, tone } = PRESET[kind];
  return (
    <Banner tone={tone} icon={<Icon aria-hidden="true" />} title={title} action={action}>
      {body}
      {footnote ? (
        <>
          <br />
          {footnote}
        </>
      ) : null}
    </Banner>
  );
}

/** The wording for a feature that does not exist yet. Says so plainly: the
 *  worst version of this screen is one that implies the user did something
 *  wrong, or that the data is missing rather than the feature. */
export function ComingSoon({
  feature,
  note,
}: {
  feature: string;
  note?: string;
}) {
  return (
    <FeatureState
      kind="not-built"
      title={`${feature} is coming soon`}
      body={`We're still building ${feature}. Nothing here is broken or hidden from you — it just hasn't shipped yet.`}
      footnote={note}
    />
  );
}
