import { PageHeaderSkeleton, SectionCardSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";

export default function SongDetailLoading() {
  return (
    <div className="rsp-page" aria-busy="true">
      <PageHeaderSkeleton back leading="thumb" hasAction={false} />
      <div className="flex flex-col gap-6" aria-hidden="true">
        <TileGridSkeleton count={4} />
        <SectionCardSkeleton title="Views by platform" height={240} />
        <SectionCardSkeleton title="Campaigns" lines={4} />
      </div>
    </div>
  );
}
