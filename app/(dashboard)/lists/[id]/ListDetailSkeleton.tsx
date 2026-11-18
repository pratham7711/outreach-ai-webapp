import { DataTableSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";

/** A list while it loads: back, name, the creator count, Share / Add / menu, then its table. */
export function ListDetailSkeleton() {
  return (
    <div className="rsp-page" aria-busy="true">
      <PageHeaderSkeleton back meta subtitle={false} actions={[92, 142, 36]} />
      <DataTableSkeleton columns={[{}, { width: 112 }, { width: 112 }, { width: 128 }, { width: 64 }]} />
    </div>
  );
}
