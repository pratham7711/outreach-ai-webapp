import { DataTableSkeleton, PageHeaderSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { DEADLINES_COLUMNS_SKELETON } from "./columns";

/* Header, the five counters, then the table: this page has no search row, so
   ListPageSkeleton's toolbar would draw a box that never arrives. */
export default function DeadlinesLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton hasAction={false} />
      <TileGridSkeleton count={5} style={{ marginBottom: 24 }} />
      <DataTableSkeleton columns={DEADLINES_COLUMNS_SKELETON} rows={6} />
    </div>
  );
}
