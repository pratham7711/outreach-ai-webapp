import React from "react";
import type { Metadata } from "next";
import { LegalShell, LegalSection, LEGAL } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Data deletion",
  description: `How to delete the data ${LEGAL.name} holds about you: disconnect an account, delete your creator account, remove the app from Meta, or email us.`,
};

/**
 * The data deletion instructions page. Meta, TikTok and Google reviewers each
 * ask for one, and it must be reachable signed out (lib/auth.config.ts).
 *
 * Every step here describes code that exists, so a change to any of them
 * changes this page too:
 *   Disconnect      DELETE /api/portal/connections  (revoke where the platform
 *                   offers it, then delete the row and its token)
 *   Delete account  POST /api/portal/account/delete  -> lib/portal/deleteCreatorLogin.ts
 *   Meta callback   /api/webhooks/meta/data-deletion -> lib/oauth/metaDeletion.ts
 */
export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Data deletion"
      intro={`How to delete the data ${LEGAL.name} holds about you. A creator can do most of it alone, straight away, without asking the agency they work with.`}
    >
      <LegalSection heading="Disconnect one account">
        <p>
          In the creator portal, open <strong>My accounts</strong> and choose{" "}
          <strong>Disconnect</strong> beside the account. We then:
        </p>
        <ul>
          <li>
            withdraw our access at the platform where it offers a way to (TikTok, Google, and
            Facebook once your last Facebook or Instagram connection through Facebook goes);
          </li>
          <li>
            delete the stored access, and the profile details stored with it, at once. Numbers
            already recorded on a campaign post stay with that campaign.
          </li>
        </ul>
        <p>
          Threads and Instagram Login publish no way for an app to withdraw its own access, so for
          those, also remove {LEGAL.name} in the app&rsquo;s own settings (below).
        </p>
      </LegalSection>

      <LegalSection heading="Delete your creator account">
        <p>
          In the creator portal, open <strong>Account</strong>, choose{" "}
          <strong>Delete my account and data</strong>, enter your password and type DELETE. We then:
        </p>
        <ul>
          <li>disconnect every account you connected, as above;</li>
          <li>delete your login, your sessions and your profile;</li>
          <li>unlink you from every agency roster you were linked to.</li>
        </ul>
        <p>
          Posts you submitted to a campaign stay with the organisation that ran it, as part of its
          campaign records; ask that organisation, or us, to remove them.
        </p>
      </LegalSection>

      <LegalSection heading="Remove the app from Facebook, Instagram or Threads">
        <p>
          Removing {LEGAL.name} under <em>Apps and websites</em> in your Facebook, Instagram or
          Threads settings sends us a deletion request. When it arrives we delete every account
          linked to that Meta login, with its stored access, before we reply, and Meta gives you a
          confirmation code. The request is complete as soon as the code is issued.
        </p>
      </LegalSection>

      <LegalSection heading="Revoke access at the platform">
        <ul>
          <li>
            TikTok: <a href="https://www.tiktok.com/setting">TikTok settings</a> &rarr; Security
            &rarr; Manage app permissions.
          </li>
          <li>
            Google and YouTube:{" "}
            <a href="https://myaccount.google.com/permissions">Google account permissions</a>.
          </li>
          <li>Facebook, Instagram and Threads: Settings &rarr; Apps and websites.</li>
        </ul>
        <p>
          Revoking there stops our reads at once. It does not delete what we already stored; use one
          of the routes above for that.
        </p>
      </LegalSection>

      <LegalSection heading="Creators who never signed up">
        <p>
          If an organisation added you to its roster or tracker, we may hold the numbers your public
          profile shows to anyone (see the{" "}
          <a href="/privacy#public-lookups">Privacy Policy</a>). Email{" "}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> with the profile link and
          we will delete them. You do not need to go through the organisation.
        </p>
      </LegalSection>

      <LegalSection heading="Anything else">
        <p>
          For anything not covered here, or a copy of your data, email{" "}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. We respond within 30
          days.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
