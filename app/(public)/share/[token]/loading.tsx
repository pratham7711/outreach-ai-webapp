/**
 * The report reads the campaign, its posts and every metric snapshot before it
 * can render anything, which is 340ms warm and about 1.9s cold. Without a
 * fallback the client who followed the link watched a blank tab for that long;
 * with one, Next streams the shell straight away.
 *
 * Built from the report's own .spr-* surfaces rather than the dashboard
 * skeletons: those paint --cc-card on --cc-bg, which on this page is a white
 * block on a white page in light theme, and they sit in a 960px column the
 * report no longer uses.
 */
function Block({ height, radius = 20 }: { height: number; radius?: number }) {
  return (
    <div
      style={{
        height,
        borderRadius: radius,
        background: "var(--spr-hairline-dark)",
      }}
    />
  );
}

export default function ShareReportLoading() {
  return (
    <div className="spr-root">
      <div className="spr-topbar">
        <div className="spr-wrap spr-topbar-in">
          <div style={{ width: 160, height: 24, borderRadius: 8, background: "var(--spr-hairline-dark)" }} />
          <div style={{ width: 260, height: 40, borderRadius: 10, background: "var(--spr-hairline-dark)" }} />
        </div>
      </div>
      <div className="spr-wrap spr-main" aria-hidden="true">
        <Block height={191} />
        <div className="spr-row">
          <Block height={475} />
          <Block height={475} />
        </div>
        <Block height={520} />
      </div>
    </div>
  );
}
