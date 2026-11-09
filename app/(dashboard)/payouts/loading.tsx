import { ListPageSkeleton } from "@/components/ui/PageSkeleton";
import { PAYOUT_COLUMNS_SKELETON } from "./columns";

export default function PayoutsLoading() {
  return <ListPageSkeleton tiles={4} filters={1} columns={PAYOUT_COLUMNS_SKELETON} rows={10} />;
}
