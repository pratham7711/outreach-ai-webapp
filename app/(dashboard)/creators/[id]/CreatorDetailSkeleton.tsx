import { PageHeaderSkeleton, SectionCardSkeleton, TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { responsiveStyles } from "./creatorDetailStyles";

/**
 * A creator while it loads: the detail header (back, avatar, platform chip,
 * the handle line, Edit and the menu), the four tiles, then the section tabs and the
 * Profile tab's two columns. Drawn by the route's loading screen and by the page's own wait.
 */
export function CreatorDetailSkeleton() {
  return (
    <div className="rsp-page" aria-busy="true">
      <style>{responsiveStyles}</style>
      <PageHeaderSkeleton back leading badges={1} meta subtitle={false} actions={[80, 36]} />
      <TileGridSkeleton count={4} footer style={{ marginBottom: 24 }} />
      <div className="cc-tabs" data-variant="underline" role="tablist" aria-hidden="true" style={{ marginBottom: 24 }}>
        {["Profile", "Posts", "Campaigns", "Social accounts"].map((label, i) => (
          <span key={label} className="cc-tab" role="tab" aria-selected={i === 0}>
            {label}
          </span>
        ))}
      </div>
      <div className="cd-profile" aria-hidden="true">
        <SectionCardSkeleton title="About" lines={3} />
        <SectionCardSkeleton title="Tags" lines={2} />
      </div>
    </div>
  );
}
