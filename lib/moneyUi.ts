/**
 * The one switch for marketplace money on the agency's screens: per-view rates
 * in campaign Settings, the accrued-against-cap bar on Posts, and the Accrued
 * and Budget cap tiles on Analytics.
 *
 * Off since October 2026, with the rest of the payments surface. Off HIDES;
 * it never clears. Stored rates stay on the campaign, and the Settings form
 * stops sending `ratePerThousand` at all -- the PATCH route keeps the stored
 * value when the key is absent, whereas sending the hidden, empty inputs would
 * have written `{}` over it.
 *
 * Turning it back on is this one line. The campaign roster's own Rate column
 * is not covered: that is the agency's agreed fee per creator, which LKM's
 * CreatorCore import carries, not marketplace money.
 */
export const SHOW_MONEY = false;
