/**
 * The sentence a creator reads when Connect fails, for each step the OAuth
 * callback can name (?error=<platform>&reason=<step>, see CallbackFailure in
 * app/api/portal/connections/[platform]/callback/route.ts).
 *
 * The banner used to print the step itself -- "Couldn't connect TikTok (token
 * exchange)" -- which tells a creator nothing they can act on and reads as a
 * broken app to a platform reviewer watching the flow. The step stays in the
 * address bar for support; the banner says what happened and what to do.
 *
 * "creator" and "provider" are not handled here: each screen words those
 * itself, because what the creator should do instead differs by screen.
 */
export function connectFailureText(name: string, reason: string | null, contact: string): string {
  switch (reason) {
    case "state":
      return `The ${name} sign-in expired or was finished in another tab. Press Connect again.`;
    case "token_exchange":
    case "token_missing":
      return `${name} didn't finish signing you in. Press Connect again.`;
    case "identity":
      return `${name} signed you in, but we couldn't read which account it was. Press Connect again.`;
    /* "Press Connect again" alone repeats the failure: Facebook remembers the
       choice, and its default ("all current and future Pages") is the one that
       shared nothing. The fix is a choice in Facebook's dialog, so name it. */
    case "no_page":
      return `Facebook didn't share any Page with us. Press Connect again, choose “Opt in to current Pages only” and tick ${/instagram/i.test(name) ? "the Page your Instagram account is linked to" : "your Page"}.`;
    case "no_instagram":
      return "None of the Pages you shared has an Instagram professional account linked to it. Link your Instagram to your Facebook Page, then press Connect again and tick that Page.";
    case "link":
      return "This connect link was turned off before you finished. Ask the agency for a new one.";
    case "exception":
      return `Something went wrong on our side while connecting ${name}. Press Connect again, and tell ${contact} if it keeps happening.`;
    default:
      return `Couldn't connect ${name}. Press Connect again, and tell ${contact} if it keeps happening.`;
  }
}
