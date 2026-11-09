import { PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import { Skeleton } from "@/components/ds";

/* The plan form while it loads: the header, then one form card a reading
   measure wide, where the dashboard's tiles and charts used to stand in. */
export default function EditPlanLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={false} />
      <div style={{ maxWidth: "36rem" }}>
        <Skeleton height={640} radius="var(--cc-r-card)" />
      </div>
    </div>
  );
}
