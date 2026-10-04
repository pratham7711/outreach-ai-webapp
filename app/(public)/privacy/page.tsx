import React from "react";
import type { Metadata } from "next";
import { LegalShell, LegalSection, LEGAL } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${LEGAL.name} collects, uses, and protects your data, including data from connected TikTok, Instagram, YouTube, Facebook Page and Threads accounts, and public profile lookups.`,
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
            account, the profile, posts and post insights described in the next section.
          </li>
          <li>
            <strong>Public profile data</strong> &mdash; for creators an organisation adds to its
            roster or tracker, the numbers their public profile shows to anyone. See{" "}
            <a href="#public-lookups">Creators who have not connected an account</a>.
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
            <strong>TikTok</strong> &mdash; with the <code>user.info.basic</code>{" "}permission we read
            the account&rsquo;s open ID, display name, and avatar. With{" "}
            <code>user.info.profile</code> we read the profile link, bio description, and
            verification status. With <code>user.info.stats</code> we read the follower, following,
            and likes counts, which is how campaign fees are agreed against audience size. With{" "}
            <code>video.list</code>{" "}we read the account&rsquo;s public videos and their view, like,
            comment, and share counts. This is shown only to the campaign manager in the
            organisation that added that creator, on that organisation&rsquo;s campaign dashboard,
            and to the creator in their own creator portal.
            We do not access private or unpublished videos, we do not read direct messages, and we
            do not post, edit, or delete content.
          </li>
          <li>
            <strong>Instagram</strong> &mdash; a professional (Business or Creator) account can be
            connected in either of two ways.
            <ul>
              <li>
                <em>Through Facebook Login</em>, via the Facebook Page the Instagram account is
                linked to. With <code>pages_show_list</code> and{" "}
                <code>pages_read_engagement</code> we find the Page and the Instagram account linked
                to it. With <code>instagram_basic</code> we read the username, name, bio, profile
                picture, follower, following and post counts, and recent posts (caption, link,
                image, date, likes and comments). With <code>instagram_manage_insights</code> we
                read views and shares on recent posts, and reach, views, shares and saves on the
                posts the creator submits to a campaign.
              </li>
              <li>
                <em>Through Instagram Login</em>, with no Facebook Page needed. With{" "}
                <code>instagram_business_basic</code> we read the same profile fields and recent
                posts, and with <code>instagram_business_manage_insights</code> the views, reach and
                shares on recent posts.
              </li>
            </ul>
          </li>
          <li>
            <strong>Facebook Pages</strong> &mdash; with <code>pages_show_list</code> we list the
            Pages you manage so you can choose one. With <code>pages_read_engagement</code>{" "}we read
            that Page&rsquo;s name, username, link, about text, picture, follower count and verified
            status, and its recent posts with their text, date, link, picture, and like, comment and
            share counts. With <code>pages_read_user_content</code>{" "}we read the comments left on
            those posts: the comment, its date, its likes and the commenter&rsquo;s name. With{" "}
            <code>read_insights</code> we read how many views each post got.
          </li>
          <li>
            <strong>Threads</strong> &mdash; with <code>threads_basic</code> we read the username,
            name, profile picture and bio, and recent posts (text, link, media and date). With{" "}
            <code>threads_manage_insights</code> we read views, likes, replies, reposts and quotes on
            those posts, and the follower count.
          </li>
          <li>
            <strong>YouTube</strong> &mdash; with <code>youtube.readonly</code>{" "}we read the
            connected channel&rsquo;s name, handle, picture and description, its subscriber, view
            and video counts, and its recent videos with their title, date, views, likes and
            comments.
          </li>
        </ul>
        <p>
          We do not read audience demographics from any platform. The creator portal&rsquo;s My
          accounts screen lists the same reads, permission by permission, beside each Connect
          button.
        </p>
        <p>
          Access tokens are encrypted at rest with AES-256-GCM and are never exposed to other
          organisations. Revoking access in the platform&rsquo;s own settings, or disconnecting the
          account inside {LEGAL.name}, stops all further collection immediately.
        </p>
      </LegalSection>

      <LegalSection heading="Creators who have not connected an account" id="public-lookups">
        <p>
          An organisation using {LEGAL.name} can add a creator to its roster or tracker without that
          creator connecting anything. For those creators we read only what their profile shows to
          anyone, and only on the platforms below:
        </p>
        <ul>
          <li>
            <strong>Instagram</strong> &mdash; through Meta&rsquo;s Business Discovery API, which
            answers for Business and Creator accounts only: the username, follower and post counts,
            profile picture, and recent public posts with their public view, like and comment
            counts. Personal and private accounts return nothing.
          </li>
          <li>
            <strong>YouTube</strong> &mdash; through the YouTube Data API: the channel&rsquo;s public
            name, picture and subscriber count, and the public statistics of its recent videos.
          </li>
          <li>
            <strong>TikTok</strong> &mdash; from the public profile page: the follower count and
            the public counts on recent videos.
          </li>
        </ul>
        <p>
          We also read the public numbers on individual post links that a creator or an organisation
          submits to a campaign. These readings are shown only to the organisation that added the
          creator, and to the creator if they sign up to the creator portal. A creator who wants them
          removed can email <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>; see{" "}
          <a href="/data-deletion">Data deletion</a>.
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
          You can disconnect a TikTok account at any time from the My accounts screen inside{" "}
          {LEGAL.name}, or by revoking access in your{" "}
          <a href="https://www.tiktok.com/setting">TikTok account settings</a>. On disconnection we
          revoke the token with TikTok, delete the stored access and refresh tokens immediately, and
          stop all further collection. Previously collected post metrics can be deleted on request to{" "}
          <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
        </p>
        <p>
          TikTok&rsquo;s own handling of your information is described in the{" "}
          <a href="https://www.tiktok.com/legal/page/row/privacy-policy/en">
            TikTok Privacy Policy
          </a>
          .
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
        <p>
          {LEGAL.name}&rsquo;s use and transfer to any other app of information received from Google
          APIs will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We use data from a connected YouTube channel
          only to show its numbers to the creator and to the organisations running their campaigns.
          We do not sell it, and we do not use it for advertising.
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

      <LegalSection heading="Cookies and storage on your device">
        <p>
          {LEGAL.name}{" "}stores a small amount of information in your browser. Cookies keep you signed
          in to the agency app and to the creator portal. Short-lived cookies protect the connection
          flow while you connect a social account, and expire when it finishes. Your browser&rsquo;s
          local storage remembers display preferences, such as the colour theme, the sidebar state
          and when you last opened notifications.
        </p>
        <p>
          We do not use advertising or analytics cookies, and we do not allow third parties to place
          cookies on, or collect information from, your device through {LEGAL.name}. Our server logs
          record your IP address and browser type for security, and are kept for up to 90 days.
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
        <p>
          A creator with a portal login can also do it themselves: Disconnect on the My accounts
          screen deletes that account&rsquo;s stored access straight away, and Delete my account and
          data on the Account screen deletes the login and every connected account. Removing{" "}
          {LEGAL.name} from Facebook, Instagram or Threads settings sends us a deletion request that
          deletes the linked account the moment it arrives. All three routes are described on the{" "}
          <a href="/data-deletion">Data deletion</a> page.
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
