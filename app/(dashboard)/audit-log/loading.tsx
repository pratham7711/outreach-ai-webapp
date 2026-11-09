import { ListPageSkeleton } from "@/components/ui/PageSkeleton";
import { AUDIT_LOG_COLUMNS_SKELETON } from "./columns";

export default function AuditLogLoading() {
  return <ListPageSkeleton filters={2} columns={AUDIT_LOG_COLUMNS_SKELETON} rows={10} />;
}
