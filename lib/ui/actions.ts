/**
 * The registry of user-visible actions, and the only way to tag one.
 *
 * A theme has to be able to say "this control is not offered here" without a
 * component edit. That needs a stable name for the control -- and the name has
 * to be checkable, or the rule silently matches nothing and reads as a CSS bug.
 * Hence a const tuple: `action("new-campiagn")` is a type error, not a no-op.
 *
 * Not `data-testid`: that attribute has 101 uses as a test selector, and a test
 * moving its hook must not move a theme's. Not a class either -- a class is
 * where we put styling, and this is an identity.
 *
 * The payoff is a one-line rule that works only because the inline style is
 * gone from the call site:
 *
 *   :root.creatorcore [data-action="self-serve-campaign"] { display: none }
 */
export const ACTIONS = [
  "add-activation",
  "add-song",
  "create-api-key",
  "export-csv",
  "export-data",
  "invite-member",
  "new-campaign",
  "new-client",
  "new-creator",
  "new-list",
  "new-media-kit",
  "new-plan",
  "new-report",
  "self-serve-campaign",
  "track-creator",
  "track-sound",
] as const;

export type ActionId = (typeof ACTIONS)[number];

const KNOWN: ReadonlySet<string> = new Set(ACTIONS);

/** True for a string that is in the registry. For the runtime assertion in E2E. */
export function isActionId(value: string): value is ActionId {
  return KNOWN.has(value);
}

/**
 * Spread onto the element:  <Button {...action("new-client")}>New Client</Button>
 *
 * Returns the attribute rather than taking a ref or wrapping the child, so it
 * composes with any component that spreads its rest props -- which `Button`
 * does, through `@pratham7711/ui`'s own `...u` spread onto the real <button>.
 */
export function action(id: ActionId): { "data-action": ActionId } {
  return { "data-action": id };
}
