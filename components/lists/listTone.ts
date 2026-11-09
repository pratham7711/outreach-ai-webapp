import type { StatusTone } from "@/components/ds";
import type { ListStatus } from "@/lib/lists/approval";

export const LIST_TONE: Record<ListStatus, StatusTone> = {
  DRAFT: "neutral",
  SHARED: "info",
  APPROVED: "success",
  ARCHIVED: "neutral",
};
