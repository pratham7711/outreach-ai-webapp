import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, LegalSection, LEGAL } from "@/components/LegalShell";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "About",
  description: `What ${LEGAL.name} is, who uses it, what it reads from a connected account, and how to reach us.`,
};

/**
 * Who runs the app and how to reach them, signed out (lib/auth.config.ts).
 * Meta and TikTok reviewers look for this from the website URL alongside the
 * policies. Says nothing the landing page and the policies do not already say.
 */
export default function AboutPage() {
  return (
    <LegalShell
      title={`About ${LEGAL.name}`}
      dated={false}
      intro={`${LEGAL.name} is campaign management software for talent agencies and record labels. Agencies brief creators, track the posts those creators publish, and reconcile payouts against verified performance, in one place instead of a spreadsheet and a folder of screenshots.`}
    >
      <LegalSection heading="Who uses it">
        <p>
          Agencies and labels run their campaigns in the app: they build a roster, brief creators,
          and report on the posts delivered against each brief.
        </p>
        <p>
          Creators use the creator portal. There they join campaigns, connect their own TikTok,
          Instagram, Facebook or YouTube accounts, and see their own numbers on <strong>My stats</strong>.
        </p>
      </LegalSection>

      <LegalSection heading="Connected accounts">
        <p>
          A creator connects an account through the platform&rsquo;s own sign-in screen, and can
          disconnect it from <strong>My accounts</strong>{" "}at any time. We read the profile and the
          post performance the creator lets the platform share with us, to show the creator their
          numbers and to report the posts they deliver on a campaign. We never publish, edit or
          delete anything on a creator&rsquo;s account.
        </p>
        <p>
          The <Link href="/privacy">Privacy Policy</Link> lists every permission we ask for and
          what each one reads. <Link href="/data-deletion">Data deletion</Link> explains how to
          remove what we hold.
        </p>
      </LegalSection>

      <LegalSection heading="Who we are">
        <p>
          {LEGAL.name} is a <a href={BRAND.umbrellaUrl}>{BRAND.umbrella}</a> product, run from{" "}
          {BRAND.jurisdiction}.
        </p>
      </LegalSection>

      <LegalSection heading="Contact" id="contact">
        {LEGAL.contactEmail === LEGAL.privacyEmail ? (
          <p>
            Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> about the
            product, an account or your data.
          </p>
        ) : (
          <p>
            Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> about the product
            or an account, and <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a> about
            your data.
          </p>
        )}
      </LegalSection>
    </LegalShell>
  );
}
