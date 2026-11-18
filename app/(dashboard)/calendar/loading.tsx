import { PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import { Skeleton } from "@/components/ds/Skeleton";

export default function CalendarLoading() {
  return (
    <div className="rsp-page" aria-busy="true">
      <PageHeaderSkeleton title="Calendar" subtitle="Campaign schedule and deadlines" hasAction={false} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-hidden="true">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 34 }}>
          <Skeleton width={220} height={20} />
          <Skeleton width={68} height={34} radius="var(--cc-r-control)" />
        </div>
        <Skeleton width={460} height={12} />
        <Skeleton width="100%" height={423} radius="var(--cc-r-card)" />
      </div>
    </div>
  );
}
