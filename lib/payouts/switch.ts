/**
 * The one switch for paying creators: payouts, payout requests, recipients,
 * a creator's earnings and the payment details a payout would need.
 *
 * Off since October 2026, on Pratham's call: "no payout feature for now".
 * Turning it back on is this one line and a deploy.
 *
 * Off hides and refuses; it never deletes. Payout, PayoutRequest,
 * PayoutBalance and ViewLedger rows stay where they are, and nothing that
 * writes the CPM ledger changes (POST /api/campaigns/[id]/view-ledger keeps
 * accruing). What reads this:
 *
 *  - every payout API route, which answers 404 while it is off, before it
 *    looks at the session -- lib/payouts/routeGate.ts. The permission checks
 *    behind it are untouched, so they are the same when it comes back on;
 *  - next.config.ts, which redirects the payout pages (/payouts, /requests,
 *    /recipients, /portal/earnings, /portal/payout-requests) only while off;
 *  - the agency sidebar and the creator app's nav, which list them only
 *    while on;
 *  - the MCP server (list_payouts, get_org_kpis' payout figures), the AI
 *    briefing and natural-language query routes, and the AI tool registry's
 *    request_payout;
 *  - payment details: PATCH /api/creators/[id] refuses paymentInfo and
 *    PATCH /api/portal/me refuses the bank fields while off, and those routes
 *    and /api/portal/dashboard stop sending paymentInfo, the bank fields and
 *    lifetimeEarnings back;
 *  - notification settings, the public creator page's Lifetime Earnings tile
 *    and the API Keys page's description of what MCP can read.
 *
 * Separate from SHOW_MONEY (lib/moneyUi.ts), which hides marketplace rates
 * and budget caps -- rate cards and budgets are not payouts and stay.
 *
 * Dependency-free on purpose: next.config.ts imports it before anything is
 * compiled, and so do client components.
 */
export const PAYOUTS_ENABLED: boolean = false;
