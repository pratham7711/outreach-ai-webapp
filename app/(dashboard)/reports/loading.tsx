import { DataTableSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import { REPORT_COLUMNS_SKELETON } from "./columns";

/* Header, then the table: the reports list has no toolbar row. */
export default function ReportsLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={REPORT_COLUMNS_SKELETON} rows={6} />
    </div>
  );
}
