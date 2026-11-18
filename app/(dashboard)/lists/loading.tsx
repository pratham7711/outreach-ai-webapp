import { CardGridPageSkeleton, CardGridSkeleton } from "@/components/ui/PageSkeleton";

export default function ListsLoading() {
  return (
    <CardGridPageSkeleton header={{ title: "Lists", subtitle: "Organize creators into curated lists", actions: [108] }}>
      <CardGridSkeleton count={3} className="rsp-grid-3" style={undefined} height={116} lead="none" stats={0} />
    </CardGridPageSkeleton>
  );
}
