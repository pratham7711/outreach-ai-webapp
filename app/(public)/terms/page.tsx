import React from "react";
import type { Metadata } from "next";
import { LegalShell, LegalSection, LEGAL } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms that govern use of ${LEGAL.name}.`,
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These terms govern your use of ${LEGAL.name}. By creating an account or connecting a social account, you agree to them.`}
    >
      <LegalSection heading="The service">
        <p>
          {LEGAL.name} is an influencer campaign management platform. It lets agencies, record
          labels, and brands brief creators, track the posts those creators publish, and record
          payouts. We provide it on a subscription or pilot basis as agreed with your organisation.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts">
        <p>
          You are responsible for the accuracy of the information you enter, for keeping your
          credentials secure, and for the activity of users you invite into your organisation. You
          must be at least 18 years old and authorised to act for the organisation you register.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          You may not use {LEGAL.name} to break the law, to infringe anyone&rsquo;s rights, to
          upload malware, to attempt to access another organisation&rsquo;s data, or to scrape or
          resell data obtained through the connected platform APIs. You may not use it in a way that
          breaches the terms of any platform you connect, including TikTok, Instagram, and YouTube.
        </p>
      </LegalSection>

      <LegalSection heading="Connected platforms">
        <p>
          Connecting a social account is optional and initiated by the account holder through that
          platform&rsquo;s own consent screen. Your use of data retrieved from those platforms is
          also governed by their terms. We are not responsible for changes those platforms make to
          their APIs, including changes that remove data the product previously displayed.
        </p>
        <p>
          Where a platform does not expose a metric, {LEGAL.name} does not estimate or infer it.
          Reporting reflects only what the platform actually returns.
        </p>
      </LegalSection>

      <LegalSection heading="Your content">
        <p>
          You keep ownership of the campaign data, briefs, and creator records you enter. You grant
          us only the licence needed to host and process that data in order to provide the service.
        </p>
      </LegalSection>

      <LegalSection heading="Availability">
        <p>
          We aim to keep the service available but do not guarantee uninterrupted access. We may
          change or discontinue features. For material reductions in functionality we will give
          reasonable notice to account owners.
        </p>
      </LegalSection>

      <LegalSection heading="Payment">
        <p>
          Fees, billing period, and payment terms are those agreed with your organisation. Payouts
          you record inside {LEGAL.name} are a bookkeeping record only &mdash; we do not move money
          and are not a payment processor.
        </p>
      </LegalSection>

      <LegalSection heading="Termination">
        <p>
          You may stop using the service and close your account at any time. We may suspend or
          terminate access for breach of these terms. On termination we handle your data as
          described in the <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection heading="Liability">
        <p>
          The service is provided as is. To the extent permitted by law we exclude implied
          warranties, and our aggregate liability is limited to the fees paid in the twelve months
          before the claim. Nothing here excludes liability that cannot lawfully be excluded.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about these terms can go to{" "}
          <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
