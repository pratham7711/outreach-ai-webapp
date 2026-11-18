import { PageHeaderSkeleton, SectionCardSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";

/**
 * A campaign while it loads, in the Overview's own layout: the detail header
 * (back, title, status, the facts line, Share and the menu), then
 * .cc-overview-grid with the tiles across the top, Activity on the right and
 * the Tags and Brief cards on the left. The route's loading screen and the
 * page's own wait both draw this, so the one never swaps for the other.
 */
export function CampaignDetailSkeleton() {
  return (
    <div className="cc-page-content rsp-page" aria-busy="true">
      <PageHeaderSkeleton back badges={1} meta subtitle={false} actions={[150, 36]} />
      <div className="cc-overview-grid" aria-hidden="true">
        <div className="cc-overview-main">
          <TileGridSkeleton count={3} footer />
        </div>
        <div className="cc-overview-side">
          <SectionCardSkeleton title="Activity" lines={6} />
        </div>
        <div className="cc-overview-main">
          <SectionCardSkeleton title="Tags" lines={1} />
          <SectionCardSkeleton title="Creative brief" lines={3} />
        </div>
      </div>
    </div>
  );
}
