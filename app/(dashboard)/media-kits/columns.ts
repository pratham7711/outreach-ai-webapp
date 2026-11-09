import type { SkeletonColumn } from "@/components/ui/PageSkeleton";

/** Column widths shared by the media kits table and its loading skeleton.
 *  Title takes what is left. */
export const MEDIA_KITS_WIDTHS = {
  creators: 120,
  created: 144,
  visibility: 128,
  actions: 168,
} as const;

export const MEDIA_KITS_COLUMNS_SKELETON: SkeletonColumn[] = [
  {},
  { width: MEDIA_KITS_WIDTHS.creators, align: "right" },
  { width: MEDIA_KITS_WIDTHS.created },
  { width: MEDIA_KITS_WIDTHS.visibility },
  { width: MEDIA_KITS_WIDTHS.actions },
];
