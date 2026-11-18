import { PageHeaderSkeleton, SectionCardSkeleton } from "@/components/ui/PageSkeleton";
import { Skeleton } from "@/components/ds/Skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="rsp-page" aria-busy="true">
      <PageHeaderSkeleton
        title="Analytics"
        subtitle={false}
        hasAction={false}
        tabs={["Overview", "Compare campaigns", "Creators & platforms", "Timing"].map((label) => ({ label, icon: true }))}
      />
      <div className="flex flex-col gap-6" aria-hidden="true">
        <Skeleton width={260} height={36} radius="var(--cc-r-control)" />
        <SectionCardSkeleton title="Campaigns launched" height={300} />
      </div>
    </div>
  );
}
