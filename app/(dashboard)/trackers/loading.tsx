import { ListPageSkeleton } from "@/components/ui/PageSkeleton";

export default function TrackersLoading() {
  return (
    <ListPageSkeleton
      tiles={4}
      tileFooter
      filters={1}
      columns={[{}, { width: 120 }, { width: 120, align: "right" }, { width: 120, align: "right" }]}
      rows={6}
      header={{ title: "Trackers", actions: [106, 136, 36], tabs: ["Audios", "Creators"] }}
    />
  );
}
