"use client";

import {
  BadgeCheck,
  ChartColumn,
  Coins,
  Compass,
  Download,
  FileChartColumn,
  Images,
  KeyRound,
  Music,
  Palette,
  ScrollText,
  Sparkles,
  ToggleRight,
  Wallet,
} from "lucide-react";
import { Input, Textarea } from "@pratham7711/ui";
import { Field } from "@/components/ds";
import { ModalOption, ModalOptionList } from "@/components/ds/Modal";
import { Switch } from "@/components/ds/Switch";
import { FEATURES, type FeatureKey } from "@/lib/features";
import {
  ADVANCED_REPORTS_FEATURE,
  AI_ASSISTANT_FEATURE,
  ANALYTICS_FEATURE,
  API_ACCESS_FEATURE,
  AUDIT_LOG_FEATURE,
  BULK_EXPORT_FEATURE,
  CAMPAIGN_BUDGET_FEATURE,
  CUSTOM_BRANDING_FEATURE,
  DISCOVERY_FEATURE,
  MEDIA_KITS_FEATURE,
  MULTI_CURRENCY_FEATURE,
  SONGS_FEATURE,
} from "@/lib/featureKeys";

/**
 * The fields of a plan, shared by the New/Edit plan dialog on /plans and the
 * page form at /plans/new and /plans/<id>.
 *
 * The two forms used to be written twice and had drifted: the page labelled
 * its name "Plan Name *" by hand, drew its own 44x24 switches, had no "custom
 * plan" switch and sent isCustom: true on every save -- so editing a Default
 * plan from the page turned it into a Custom one. Both now draw these.
 */

export type PlanDraft = {
  name: string;
  description: string;
  features: Record<string, boolean>;
  isCustom: boolean;
};

export const featureKeys = Object.keys(FEATURES) as FeatureKey[];

/* One glyph per feature row, so the list of twelve reads by shape as well as
   by name. A key added to FEATURES later falls back to the generic toggle. */
export const FEATURE_ICONS: Partial<Record<FeatureKey, React.ElementType>> = {
  [ANALYTICS_FEATURE]: ChartColumn,
  [BULK_EXPORT_FEATURE]: Download,
  [API_ACCESS_FEATURE]: KeyRound,
  [CUSTOM_BRANDING_FEATURE]: Palette,
  [ADVANCED_REPORTS_FEATURE]: FileChartColumn,
  [DISCOVERY_FEATURE]: Compass,
  [CAMPAIGN_BUDGET_FEATURE]: Wallet,
  [MULTI_CURRENCY_FEATURE]: Coins,
  [AUDIT_LOG_FEATURE]: ScrollText,
  [MEDIA_KITS_FEATURE]: Images,
  [SONGS_FEATURE]: Music,
  [AI_ASSISTANT_FEATURE]: Sparkles,
};

/** A draft with every feature key present, so two drafts compare field by field. */
export function planDraft(initial?: {
  name?: string;
  description?: string | null;
  features?: Record<string, boolean>;
  isCustom?: boolean;
}): PlanDraft {
  const features: Record<string, boolean> = {};
  for (const key of featureKeys) features[key] = initial?.features?.[key] ?? false;
  return {
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    features,
    isCustom: initial?.isCustom ?? true,
  };
}

type FieldsProps = {
  draft: PlanDraft;
  onChange: (next: PlanDraft) => void;
  autoFocus?: boolean;
};

/** Name (required), description, and the Custom/Default switch. */
export function PlanDetailsFields({ draft, onChange, autoFocus }: FieldsProps) {
  return (
    <>
      <Field label="Plan name" required>
        <Input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="e.g. Pro"
          maxLength={100}
          autoFocus={autoFocus}
        />
      </Field>

      <Field label="Description">
        <Textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          placeholder="Who the plan is for"
          rows={3}
        />
      </Field>

      <ModalOptionList>
        <ModalOption
          icon={BadgeCheck}
          title="Mark as custom plan"
          description="Badged Custom in the plan list; otherwise Default."
          control={
            <Switch
              checked={draft.isCustom}
              onChange={(isCustom) => onChange({ ...draft, isCustom })}
              aria-label="Mark as custom plan"
            />
          }
        />
      </ModalOptionList>
    </>
  );
}

/** One switch per feature, with its glyph and description. */
export function PlanFeatureList({ draft, onChange }: FieldsProps) {
  return (
    <ModalOptionList>
      {featureKeys.map((key) => (
        <ModalOption
          key={key}
          icon={FEATURE_ICONS[key] ?? ToggleRight}
          title={FEATURES[key].label}
          description={FEATURES[key].description}
          control={
            <Switch
              checked={draft.features[key] ?? false}
              onChange={(v) => onChange({ ...draft, features: { ...draft.features, [key]: v } })}
              aria-label={FEATURES[key].label}
            />
          }
        />
      ))}
    </ModalOptionList>
  );
}

export function enabledCount(draft: Pick<PlanDraft, "features">): number {
  return featureKeys.filter((key) => draft.features[key]).length;
}
