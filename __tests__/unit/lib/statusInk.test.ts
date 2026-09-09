import {
  statusInk,
  campaignStatusDot,
  campaignStatusCss,
  CAMPAIGN_STATUS_STYLE,
} from "@/lib/statusColors";
import { contrastRatio } from "@/lib/ai/whitelabel/theme";

/* A status style carries two colours and they mean different things: `color` is
   the text colour ON that status's own chip, `bg` is the chip. Active is a
   solid blue pill with WHITE text, so painting its `color` anywhere other than
   the pill puts white on a near-white page -- which is exactly how the
   campaigns filter strip shipped an invisible "Active" tab. */

const WHITE = "#FFFFFF";

describe("statusInk", () => {
  it("does not hand back a foreground that is invisible on the page", () => {
    // The bug, stated as a number: Active's own text colour on the app surface.
    expect(contrastRatio(CAMPAIGN_STATUS_STYLE.IN_PROGRESS.color, WHITE)).toBeCloseTo(1, 1);
    // ...so the ink must be the fill instead.
    expect(statusInk(CAMPAIGN_STATUS_STYLE.IN_PROGRESS)).toBe("#3B75F2");
  });

  it("leaves a tinted status on its own foreground", () => {
    // A 12.5%-alpha wash of the surface cannot be the ink, so these keep `color`.
    expect(statusInk(CAMPAIGN_STATUS_STYLE.PENDING)).toBe("#E7AD00");
    expect(statusInk(CAMPAIGN_STATUS_STYLE.COMPLETE)).toBe("#56BA57");
    expect(statusInk(CAMPAIGN_STATUS_STYLE.CANCELLED)).toBe("#FF0000");
    expect(statusInk(CAMPAIGN_STATUS_STYLE.DRAFT)).toBe("#6B7280");
    expect(statusInk(CAMPAIGN_STATUS_STYLE.ALL)).toBe("#374151");
  });

  it("never returns pure white for any status in the palette", () => {
    for (const [name, style] of Object.entries(CAMPAIGN_STATUS_STYLE)) {
      expect(`${name}:${statusInk(style).toUpperCase()}`).not.toBe(`${name}:#FFFFFF`);
    }
  });

  it("is the rule campaignStatusDot uses, rather than a second copy of it", () => {
    for (const status of Object.keys(CAMPAIGN_STATUS_STYLE)) {
      expect(campaignStatusDot(status)).toBe(statusInk(CAMPAIGN_STATUS_STYLE[status]));
    }
  });

  it("does not disturb the chip itself, which is reference-app parity", () => {
    // The pill keeps white-on-blue: that pairing is correct where it belongs.
    expect(campaignStatusCss("IN_PROGRESS")).toEqual({ background: "#3B75F2", color: "#FFFFFF" });
  });
});
