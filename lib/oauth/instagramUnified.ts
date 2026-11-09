/**
 * Whether the creator Instagram button runs Meta's Unified login, and the copy
 * that follows from it.
 *
 * The configuration id is public: it travels in the authorize URL. It is a
 * NEXT_PUBLIC_ variable so the portal's client pages and the OAuth routes read
 * the same value, and a card never says "via Facebook Page" for a connection
 * that involved no Page. Read with a literal property access so Next inlines it
 * into client bundles at build time.
 */
export function instagramLoginConfigId(): string | null {
  const id = process.env.NEXT_PUBLIC_META_INSTAGRAM_LOGIN_CONFIG_ID?.trim();
  return id && /^\d+$/.test(id) ? id : null;
}

export function instagramUnifiedLogin(): boolean {
  return instagramLoginConfigId() !== null;
}

export function instagramCardLabel(): string {
  return instagramUnifiedLogin() ? "Instagram" : "Instagram (via Facebook Page)";
}

export function instagramCardNote(): string {
  return instagramUnifiedLogin()
    ? "Sign in with Instagram or Facebook. No Facebook Page needed."
    : "Through the Facebook Page your Instagram is linked to.";
}
