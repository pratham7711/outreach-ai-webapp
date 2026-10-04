/**
 * @jest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import AboutPage from "@/app/(public)/about/page";
import PrivacyPage from "@/app/(public)/privacy/page";
import TermsPage from "@/app/(public)/terms/page";
import DataDeletionPage from "@/app/(public)/data-deletion/page";
import { LEGAL } from "@/components/LegalShell";

/**
 * The compiler drops the leading space of a JSX text run that holds an HTML
 * entity when the run follows an element or an expression, so
 * `<strong>My accounts</strong> at any time ... creator&rsquo;s` rendered as
 * "My accountsat any time". Reviewers read these pages as text; check the text.
 */
function text(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("public policy pages keep the space after an inline element", () => {
  it("/about", () => {
    const page = text(AboutPage());
    expect(page).toContain("disconnect it from My accounts at any time.");
  });

  it("/about names one contact address once when both are the same", () => {
    const page = text(AboutPage());
    const mentions = page.split(LEGAL.contactEmail).length - 1;
    expect(mentions).toBeGreaterThan(0);
    if (LEGAL.contactEmail === LEGAL.privacyEmail) {
      expect(page).toContain(`Email ${LEGAL.contactEmail} about the product, an account or your data.`);
    }
  });

  it("/privacy", () => {
    const page = text(PrivacyPage());
    for (const phrase of [
      "user.info.basic permission we read",
      "video.list we read the account’s public videos",
      "pages_read_engagement we read that Page’s name",
      "pages_read_user_content we read the comments",
      "youtube.readonly we read the connected channel’s name",
      `${LEGAL.name} stores a small amount of information in your browser.`,
      `collect information from, your device through ${LEGAL.name}.`,
    ]) {
      expect(page).toContain(phrase);
    }
  });

  it("/terms", () => {
    const page = text(TermsPage());
    expect(page).toContain(`You may not use ${LEGAL.name} to break the law`);
    expect(page).toContain(`you record inside ${LEGAL.name} are a bookkeeping record only`);
    expect(page).toContain(
      "you agree to be bound by the YouTube Terms of Service, and Google handles your data under the Google Privacy Policy."
    );
    expect(page).toContain(`Google security settings or by disconnecting the channel in ${LEGAL.name}.`);
    expect(page).toContain("including TikTok, Instagram, Facebook and YouTube.");
  });

  it("/data-deletion", async () => {
    const page = text(await DataDeletionPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain(`also remove ${LEGAL.name} in the app’s own settings`);
  });
});
