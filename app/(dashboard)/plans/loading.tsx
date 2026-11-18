import { CardGridPageSkeleton, CardGridSkeleton } from "@/components/ui/PageSkeleton";

export default function PlansLoading() {
  return (
    <CardGridPageSkeleton
      toolbar={false}
      header={{ title: "Plans", subtitle: "Subscription plans and the features clients on each can use.", actions: [119] }}
    >
      <CardGridSkeleton count={3} className="" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 24 }} height={442} lead="none" stats={0} />
    </CardGridPageSkeleton>
  );
}
