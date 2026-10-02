"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LineChart } from "lucide-react";
import { Button, useConfirm } from "@/components/ds";
import { apiFetch, apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";
import { formatFull } from "@/lib/format";
import { action } from "@/lib/ui/actions";
import { bulkTrackSummary, type BulkTrackResult, type TrackStatus } from "@/lib/trackers/bulkTrackCopy";

/**
 * The three ways to track many creators at once (plan §04 "Track creators"):
 * Track all on the roster's header, Track selected in its bulk bar, and Track
 * this campaign's creators on a campaign. All three post to one endpoint,
 * which holds the agency's lock, the plan's limit and the gate; these only
 * say beforehand what the endpoint would say afterwards.
 */

export type TrackSelection = { creatorIds: string[] } | { query: string } | { campaignId: string };

export function useTrackStatus() {
  return useQuery({
    queryKey: ["track-status"],
    queryFn: () => apiFetch<TrackStatus>("/api/trackers/creators/bulk"),
    staleTime: 30_000,
  });
}

function useBulkTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { scope: "all" } | TrackSelection) =>
      apiPost<BulkTrackResult>("/api/trackers/creators/bulk", body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["track-status"] });
      queryClient.invalidateQueries({ queryKey: ["creator-trackers"] });
      const summary = bulkTrackSummary(result);
      if (result.added === 0 && result.skippedForLimit > 0) {
        toast.error(result.limitMessage ?? summary, { description: summary });
      } else {
        toast.success(summary, result.limitMessage ? { description: result.limitMessage } : undefined);
      }
    },
    onError: (error) => toast.error(errorMessage(error, "Could not track those creators")),
  });
}

/** Why a button is off, or null when it is on. The limit outranks the gate:
 *  a full plan is the thing to fix first, whatever the reader is. */
function blocked(status: TrackStatus | undefined, count: number, kind: "all" | "some"): string | null {
  if (!status) return null;
  if (status.roomLeft === 0) return status.limitMessage ?? "Every tracker on your plan is in use.";
  if (kind === "all") {
    if (!status.trackAllOpen) return status.reason;
    if (status.untracked === 0) return "Every creator on the roster is already tracked.";
    return null;
  }
  if (!status.trackAllOpen && count > status.ungatedMax) {
    return `${status.reason ?? ""} Until then, track up to ${status.ungatedMax} at a time.`.trim();
  }
  return null;
}

const QUEUE_NOTE =
  "New trackers join the back of the reading queue, so their first readings come once the creators already tracked have been read.";

/** "Track all 2,566", for the roster's header. */
export function TrackAllButton() {
  const { data: status } = useTrackStatus();
  const track = useBulkTrack();
  const confirm = useConfirm();
  if (!status || status.roster === 0) return null;

  const reason = blocked(status, status.untracked, "all");
  const willAdd = status.roomLeft === null ? status.untracked : Math.min(status.untracked, status.roomLeft);

  const run = async () => {
    const short = willAdd < status.untracked;
    const ok = await confirm({
      title: `Track all ${formatFull(status.roster)} creators?`,
      description: [
        `${formatFull(status.roster - status.untracked)} are tracked already and ${formatFull(status.untracked)} are not.`,
        short
          ? `Your plan has room for ${formatFull(willAdd)} more, so the ${formatFull(willAdd)} added to the roster longest ago are tracked and the rest are not.`
          : `All ${formatFull(willAdd)} will be tracked.`,
        QUEUE_NOTE,
      ].join(" "),
      confirmLabel: `Track ${formatFull(willAdd)}`,
      tone: "default",
    });
    if (ok) track.mutate({ scope: "all" });
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      iconLeft={<LineChart size={15} />}
      disabled={Boolean(reason)}
      title={reason ?? `Track every creator on the roster: ${formatFull(willAdd)} not tracked yet`}
      loading={track.isPending}
      onClick={run}
      {...action("track-all-creators")}
    >
      Track all {formatFull(status.roster)}
    </Button>
  );
}

/** Track selected, for the roster's bulk bar. `count` is how many are selected. */
export function TrackSelectedButton({ selection, count }: { selection: TrackSelection; count: number }) {
  const { data: status } = useTrackStatus();
  const track = useBulkTrack();
  const confirm = useConfirm();
  const reason = blocked(status, count, "some");

  const run = async () => {
    // A handful is one click; hundreds get the same pause Track all does.
    if (status && count > status.ungatedMax) {
      const ok = await confirm({
        title: `Track ${formatFull(count)} creators?`,
        description: `Any already tracked are left as they are${
          status.roomLeft !== null ? `, and at most ${formatFull(status.roomLeft)} more fit on your plan` : ""
        }. ${QUEUE_NOTE}`,
        confirmLabel: "Track them",
        tone: "default",
      });
      if (!ok) return;
    }
    track.mutate(selection);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      iconLeft={<LineChart size={15} />}
      disabled={Boolean(reason) || count === 0}
      title={reason ?? undefined}
      loading={track.isPending}
      onClick={run}
    >
      Track selected
    </Button>
  );
}

/** Track this campaign's creators, for the campaign's Creators tab. */
export function TrackCampaignCreatorsButton({ campaignId, count }: { campaignId: string; count: number }) {
  const { data: status } = useTrackStatus();
  const track = useBulkTrack();
  /* Not pre-disabled for the gate: whether a campaign is over the ungated
     maximum depends on how many of its creators are tracked already, which
     only the server counts. It answers with the reason if it is. */
  const reason = status?.roomLeft === 0 ? status.limitMessage : null;
  const hint =
    status && !status.trackAllOpen
      ? `Track this campaign's creators. Until Track all opens for this workspace, up to ${status.ungatedMax} can be added at a time.`
      : "Track this campaign's creators";

  return (
    <Button
      variant="secondary"
      iconLeft={<LineChart size={15} />}
      disabled={Boolean(reason) || count === 0}
      title={reason ?? hint}
      loading={track.isPending}
      onClick={() => track.mutate({ campaignId })}
      {...action("track-campaign-creators")}
    >
      Track this campaign&apos;s creators
    </Button>
  );
}
