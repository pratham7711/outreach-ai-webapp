import { ListPageSkeleton } from "@/components/ui/PageSkeleton";

/* The columns every campaign list has. Budget, Team and Folder appear only when
   a campaign on the page uses them, so they are left out here. */
const CAMPAIGN_COLUMNS_SKELETON = [
  {},
  { width: 96, align: "right" as const },
  { width: 80, align: "right" as const },
  { width: 128, align: "right" as const },
  { width: 160 },
  { width: 64 },
];

export default function CampaignsLoading() {
  return (
    <ListPageSkeleton
      filters={3}
      columns={CAMPAIGN_COLUMNS_SKELETON}
      rows={8}
      header={{
        title: "Campaigns",
        subtitle: false,
        actions: [105, 154],
        tabs: ["All", "Pending", "Active", "Complete", "Canceled"].map((label) => ({ label, icon: true, count: true })),
      }}
    />
  );
}
