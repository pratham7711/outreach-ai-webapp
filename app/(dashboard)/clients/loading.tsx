import { ListPageSkeleton } from "@/components/ui/PageSkeleton";
import { CLIENTS_COLUMNS_SKELETON } from "./columns";

export default function ClientsLoading() {
  return <ListPageSkeleton tiles={2} filters={0} columns={CLIENTS_COLUMNS_SKELETON} rows={6} />;
}
