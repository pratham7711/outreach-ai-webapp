import { CardGridPageSkeleton } from "@/components/ui/PageSkeleton";

export default function PlansLoading() {
  return <CardGridPageSkeleton count={3} toolbar={false} />;
}
