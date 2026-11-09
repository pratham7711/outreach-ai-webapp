import { DataTableSkeleton, PageHeaderSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { Skeleton } from "@/components/ds/Skeleton";
import { FIN_TOP_COLUMNS_SKELETON } from "./columns";

/* The report's own shape -- tiles, the trend card, the top-campaigns table --
   rather than the dashboard skeleton this route used to inherit. */
export default function FinancialReportsLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton />
      <div className="flex flex-col gap-6">
        <TileGridSkeleton count={4} />
        <div className="cc-section-card">
          <div className="cc-section-card-body" data-padded>
            <Skeleton width="100%" height={240} />
          </div>
        </div>
        <DataTableSkeleton columns={FIN_TOP_COLUMNS_SKELETON} rows={5} />
      </div>
    </div>
  );
}
