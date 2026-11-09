import { DataTableSkeleton, PageHeaderSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { ACTIVATIONS_WIDTHS } from "./columns";

/* Header, the two counter rows, then the first queue's table. */
export default function ActivationsLoading() {
  return (
    <div className="rsp-page">
      <PageHeaderSkeleton />
      <TileGridSkeleton count={3} style={{ marginBottom: 12 }} />
      <TileGridSkeleton count={4} style={{ marginBottom: 24 }} />
      <DataTableSkeleton
        columns={[{}, {}, { width: ACTIVATIONS_WIDTHS.status }, { width: ACTIVATIONS_WIDTHS.updated }, { width: ACTIVATIONS_WIDTHS.actions }]}
        rows={4}
      />
    </div>
  );
}
