/**
 * Whether the desktop rail is collapsed to its icons. A cookie rather than
 * localStorage so the dashboard layout can read it on the server and paint the
 * right width first, instead of the wide rail snapping narrow on hydration.
 * A new name on purpose: the old collapse stored `cc-sidebar-collapsed` in
 * localStorage, and anyone left with it set should start from the wide rail.
 */
export const RAIL_COOKIE = "cc-rail";
export const RAIL_COLLAPSED = "collapsed";
