"use client";

import { useEffect, useState } from "react";
import { BookmarkPlus, MoreHorizontal } from "lucide-react";
import { MenuButton } from "@/components/ds";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { fetchSetupSource, type SetupSourceResponse } from "./useStartFromSources";

/**
 * The campaign header's overflow menu, holding "Save as template". An
 * overflow rather than another labelled button: the header row already
 * carries Share Campaign and each section's own actions, and saving a
 * template is occasional. Shown only to people who may create campaigns,
 * which the setup read answers (canSave), so a viewer sees no dead control.
 */
export function SaveAsTemplateAction({ campaignId, campaignTitle }: { campaignId: string; campaignTitle: string }) {
  const [source, setSource] = useState<SetupSourceResponse | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchSetupSource("campaign", campaignId).then((read) => {
      if (live && read.ok) setSource(read.source);
    });
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (!source?.canSave) return null;

  return (
    <span className="cc-page-more" data-action-group="campaign-more">
      <MenuButton
        align="right"
        label="More campaign actions"
        trigger={
          <span className="cc-icon-btn" title="More actions">
            <MoreHorizontal size={18} aria-hidden="true" />
          </span>
        }
        items={[
          {
            label: "Save as template",
            icon: <BookmarkPlus size={15} />,
            onClick: () => setOpen(true),
          },
        ]}
      />
      {open && (
        <SaveAsTemplateDialog
          campaignId={campaignId}
          campaignTitle={campaignTitle}
          initial={source}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
