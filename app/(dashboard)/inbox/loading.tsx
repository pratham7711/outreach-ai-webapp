import { PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import { Skeleton } from "@/components/ds";

/* Header, then the one bordered box that holds the list and the thread. */
export default function InboxLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={false} />
      <Skeleton height={480} radius="var(--cc-r-card)" />
    </div>
  );
}
