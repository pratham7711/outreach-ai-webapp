/** Column widths for the activation queue tables. Creator and Campaign share
 *  what is left. The status column grows when the org has named statuses,
 *  because the picker sits beside the badge. */
export const ACTIVATIONS_WIDTHS = {
  status: 184,
  statusNamed: 320,
  updated: 128,
  actions: 208,
} as const;
