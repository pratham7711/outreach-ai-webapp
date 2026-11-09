import { ListPageSkeleton } from "@/components/ui/PageSkeleton";
import { REQUEST_COLUMNS_SKELETON } from "./columns";

export default function RequestsLoading() {
  return <ListPageSkeleton tiles={4} filters={0} columns={REQUEST_COLUMNS_SKELETON} rows={10} />;
}
