import { Skeleton } from "@/components/ds/Skeleton";
import { PageHeaderSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";

/**
 * A post while it loads: the detail header (back, video frame, status, the
 * creator line, Sync / View post / menu), then the tile row and a chart card.
 * Drawn by the route's loading screen and by the page's own wait.
 */
export function PostDetailSkeleton() {
  return (
    <div className="rsp-page" aria-busy="true">
      <PageHeaderSkeleton back leading="wide" badges={1} meta subtitle={false} actions={[118, 116, 36]} />
      <div className="cc-postpage-body" aria-hidden="true">
        <TileGridSkeleton count={5} />
        <Skeleton width="100%" height={300} radius="var(--cc-r-card)" />
      </div>
    </div>
  );
}
