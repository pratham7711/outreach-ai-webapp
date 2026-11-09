import { DataTableSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import { MEDIA_KITS_COLUMNS_SKELETON } from "./columns";

/* Header then the table: the page has no search row to draw. */
export default function MediaKitsLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={MEDIA_KITS_COLUMNS_SKELETON} rows={4} />
    </div>
  );
}
