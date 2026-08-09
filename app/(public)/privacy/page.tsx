import React from "react";
import type { Metadata } from "next";
import { LegalShell, LegalSection, LEGAL } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${LEGAL.name} collects, uses, and protects your data, including data from connected TikTok, Instagram, and YouTube accounts.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`This policy explains what ${LEGAL.name} collects, why we collect it, who we share it with, and how you can get it deleted. It covers both the campaign management application and any social accounts you choose to connect.`}
    >
      <LegalSection heading="Who we are">
        <p>
          {LEGAL.name} is an influencer campaign management platform operated by {LEGAL.entity}.
          Agencies, record labels, and brands use it to run creator campaigns &mdash; briefing
          creators, tracking published posts, and recording payouts. You can reach us at{" "}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <ul>
          <li>
            <strong>Account data</strong> &mdash; your name, email address, hashed password, and the
            organisation you belong to.
          </li>
          <li>
            <strong>Campaign data</strong> &mdash; campaigns, briefs, budgets, deliverables, creator
            records, client records, and payout amounts that you or your team enter.
          </li>
          <li>
            <strong>Connected platform data</strong> &mdash; when a creator connects a social
            account, the profile and public post metrics described in the next section.
          </li>
          <li>
            <strong>Technical data</strong> &mdash; server logs containing IP address, browser user
            agent, and timestamps, kept for security and debugging.
          </li>
        </ul>
        <p>
          We do not collect payment card details. We do not buy personal data from third parties,
          and we do not use your data to train machine learning models.
        </p>
      </LegalSection>

      <LegalSection heading="Connected social accounts">
        <p>
          Connecting a social account is always optional and always initiated by the account holder
          through that platform&rsquo;s own consent screen. We request the narrowest permissions
          that make the feature work, we never post on your behalf, and we never read direct
          messages.
        </p>
        <ul>
          <li>
            <strong>TikTok</strong> &mdash; with the <code>user.info.basic</code> permission we read
            the account&rsquo;s open ID, display name, and avatar. With{" "}
            <code>user.info.profile</code> we read the profile link, bio description, and
            verification status. With <code>user.info.stats</code> we read the follower, following,
            and likes counts, which is how campaign fees are agreed against audience size. With{" "}
            <code>video.list</code> we read the account&rsquo;s public videos and their view, like,
            comment, and share counts. This is shown only to the campaign manager in the
            organisation that added that creator, on that organisation&rsquo;s campaign dashboard.
            We do not access private or unpublished videos, we do not read direct messages, and we
            do not post, edit, or delete content.
          </li>
          <li>
            <strong>Instagram</strong> &mdash; we read the connected professional account&rsquo;s
            profile and the metrics of posts relevant to a campaign, such as plays, likes, comments,
            saves, and reach.
          </li>
          <li>
            <strong>YouTube</strong> &mdash; we read the connected channel&rsquo;s public videos and
            their public statistics.
          </li>
        </ul>
        <p>
          Access tokens are encrypted at rest with AES-256-GCM and are never exposed to other
          organisations. Revoking access in the platform&rsquo;s own settings, or disconnecting the
          account inside {LEGAL.name}, stops all further collection immediately.
        </p>
      </LegalSection>

      <LegalSection heading="TikTok data handling">
        <p>
          Data obtained through TikTok is used solely to display and report on campaign performance
          to the organisation that the connected creator is working with. We do not sell it, we do
          not share it with advertising networks, and we do not combine it with data from other
          creators to build profiles.
        </p>
        <p>
          You can disconnect a TikTok account at any time from the connections screen inside{" "}
          {LEGAL.name}, or by revoking access in your TikTok account settings. On disconnection we
          delete the stored access and refresh tokens immediately and stop all further collection.
          Previously collected post metrics can be deleted on request to{" "}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection heading="YouTube API Services">
        <p>
          {LEGAL.name} uses YouTube API Services. By connecting a YouTube channel you also agree to
          the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
          Google&rsquo;s handling of your information is described in the{" "}
          <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. You can revoke{" "}
          {LEGAL.name}&rsquo;s access to your Google account at any time via{" "}
          <a href="https://myaccount.google.com/permissions">Google security settings</a>.
        </p>
      </LegalSection>

      <LegalSection heading="How we use your data">
        <p>
          We use it to operate the product you asked for: authenticating you, showing your
          campaigns, pulling the post metrics that populate campaign reporting, recording payouts,
          and sending service email about your account. We do not use it for advertising.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>
          We share data only with the infrastructure providers needed to run the service &mdash; our
          hosting provider and our managed database provider &mdash; and with the social platforms
          you explicitly connect. We do not sell personal data. We disclose data to authorities only
          where legally compelled.
        </p>
      </LegalSection>

      <LegalSection heading="How long we keep it">
        <p>
          Account and campaign data is kept while your organisation has an active account. Connected
          platform tokens are deleted on disconnection. Server logs are retained for up to 90 days.
          On account closure we delete your data within 30 days, except where we are required to
          retain records for legal or accounting reasons.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can request a copy of your data, correction of inaccurate data, or deletion of your
          data by emailing <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. We
          respond within 30 days. If a creator wants their connected-account data removed, they can
          email us directly and do not need to go through the agency.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Traffic is served over TLS. Passwords are hashed. Platform access tokens are encrypted at
          rest with AES-256-GCM. Access is scoped per organisation, and every query is filtered by
          organisation so one customer cannot read another&rsquo;s data.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          {LEGAL.name} is a business tool and is not directed at children. We do not knowingly
          collect data from anyone under 18. If you believe we have, contact us and we will delete
          it.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we change this policy we will update the date at the top of this page and, for material
          changes, notify account owners by email.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
