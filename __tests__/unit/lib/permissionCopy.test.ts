/**
 * @jest-environment node
 *
 * The connect page says, per permission, what the agency reads with it. A
 * scope requested in lib/oauth/providers.ts with no line here would be a
 * permission asked for without saying why.
 */
import { CONNECT_READS } from "@/lib/portal/permissionCopy";
import { OAUTH_PLATFORMS, requestedScopes } from "@/lib/oauth/providers";

describe("CONNECT_READS", () => {
  it.each([...OAUTH_PLATFORMS])("explains every scope %s requests, and no other", (platform) => {
    const explained = CONNECT_READS[platform].lines.map((line) => line.scope).sort();
    expect(explained).toEqual([...requestedScopes(platform)].sort());
  });

  it.each([...OAUTH_PLATFORMS])("gives %s a label and a sentence per line", (platform) => {
    expect(CONNECT_READS[platform].label.trim()).not.toBe("");
    for (const line of CONNECT_READS[platform].lines) expect(line.reads.trim().length).toBeGreaterThan(10);
  });
});
