/**
 * The property classification the whole layout conversion turns on.
 *
 * LAYOUT is what a theme must be able to move. It is the banned set for the
 * `cc/no-inline-layout-style` lint rule and the target of the codemod.
 * TYPE and PAINT are converted too, but into type/colour classes rather than
 * layout classes, which is why a "mixed" style object splits into two halves
 * instead of being rewritten as one.
 */
export const LAYOUT_PROPS = new Set([
  "display", "gap", "rowGap", "columnGap",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "paddingInline", "paddingBlock", "paddingInlineStart", "paddingInlineEnd",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "marginInline", "marginBlock", "marginInlineStart", "marginInlineEnd",
  "alignItems", "alignSelf", "alignContent",
  "justifyContent", "justifySelf", "justifyItems", "placeItems", "placeContent",
  "flex", "flexDirection", "flexWrap", "flexGrow", "flexShrink", "flexBasis",
  "gridTemplateColumns", "gridTemplateRows", "gridTemplateAreas",
  "gridColumn", "gridRow", "gridArea", "gridAutoFlow", "gridAutoRows", "gridAutoColumns",
  "order",
  "position", "top", "right", "bottom", "left", "inset",
  "zIndex",
  "overflow", "overflowX", "overflowY",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
]);

/**
 * Dimensions are layout, but a COMPUTED dimension is legitimate -- a progress
 * bar's `width: ${pct}%` has no class equivalent. The lint rule allows these
 * only when the value is not a literal.
 */
export const DIMENSION_PROPS = new Set([
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
]);

export const TYPE_PROPS = new Set([
  "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform",
  "textAlign", "whiteSpace", "textOverflow", "fontStyle", "fontFamily",
  "textDecoration", "wordBreak", "overflowWrap", "fontVariantNumeric",
]);

export const PAINT_PROPS = new Set([
  "color", "background", "backgroundColor", "backgroundImage", "borderRadius",
  "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
  "borderColor", "borderWidth", "borderStyle", "boxShadow", "opacity",
  "outline", "fill", "stroke",
]);

export function classify(prop) {
  if (LAYOUT_PROPS.has(prop)) return "layout";
  if (TYPE_PROPS.has(prop)) return "type";
  if (PAINT_PROPS.has(prop)) return "paint";
  return "other";
}
