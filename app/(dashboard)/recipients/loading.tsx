import { ListPageSkeleton } from "@/components/ui/PageSkeleton";
import { RECIPIENT_COLUMNS_SKELETON } from "./columns";

export default function RecipientsLoading() {
  return <ListPageSkeleton tiles={4} filters={0} hasAction={false} columns={RECIPIENT_COLUMNS_SKELETON} rows={10} />;
}
