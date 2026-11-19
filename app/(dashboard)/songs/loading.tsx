import { CardGridPageSkeleton, CardGridSkeleton } from "@/components/ui/PageSkeleton";

export default function SongsLoading() {
  return (
    <CardGridPageSkeleton filters={0} header={{ title: "Songs", subtitle: false, actions: [120] }}>
      <CardGridSkeleton count={6} height={153} lead="cover" stats={3} />
    </CardGridPageSkeleton>
  );
}
