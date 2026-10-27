import { test, expect, type Locator, type Page } from '@playwright/test';
import { navigateAndWait } from './helpers';

/*
 * A campaign's audio: a TikTok sound, an Instagram audio and a Spotify track,
 * side by side, in the New Campaign form and in the campaign's settings.
 *
 * A link goes to its own field whichever one it is pasted into, and a link
 * that can never give a number to follow is left out with a line saying why.
 * The suite makes no live platform reads, so the check routes are answered
 * here; nothing is saved, and the seed stays as it was.
 */

const INSTAGRAM_AUDIO = 'https://www.instagram.com/reels/audio/2094289147512017/';
const ORIGINAL_AUDIO = 'https://www.instagram.com/reels/audio/932615931412635/';
const TIKTOK_SOUND = 'https://www.tiktok.com/music/Runaway-6604064037363780357';
const SPOTIFY_TRACK = 'https://open.spotify.com/track/69bRMupnNveGN0PbZNoctn';

/* A paste, as the browser delivers one: a ClipboardEvent carrying the text.
   Dispatched rather than typed with the OS clipboard, which a headless CI
   browser may not grant. */
async function paste(field: Locator, text: string) {
  await field.click();
  await field.evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/* What the resolve and Spotify routes would say about each link. */
async function answerChecks(page: Page) {
  const asked: string[] = [];
  await page.route('**/api/campaigns/audio/resolve', async (route) => {
    const url = JSON.parse(route.request().postData() ?? '{}').url as string;
    asked.push(url);
    if (url === ORIGINAL_AUDIO) {
      await route.fulfill({
        status: 400,
        json: { error: 'instagram_audio_no_count', message: "Instagram doesn't publish a use count for that audio." },
      });
    } else if (url.includes('instagram.com')) {
      await route.fulfill({
        json: {
          platform: 'INSTAGRAM', verified: true, soundId: '2094289147512017', provisionalTitle: 'Runaway',
          artist: 'AURORA', coverImageUrl: null, usesCount: 2000000, usesRounded: true,
        },
      });
    } else {
      await route.fulfill({
        json: {
          platform: 'TIKTOK', verified: true, soundId: '6604064037363780357', provisionalTitle: 'Runaway',
          artist: 'AURORA', coverImageUrl: '/app-icon-1024.png', usesCount: 1200000,
        },
      });
    }
  });
  await page.route('**/api/songs/spotify-check**', (route) =>
    route.fulfill({ json: { trackId: '69bRMupnNveGN0PbZNoctn', url: SPOTIFY_TRACK, title: 'Runaway', thumbnailUrl: null } })
  );
  return asked;
}

test.describe('Campaign audio in the New Campaign form', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns');
    await page.getByRole('button', { name: 'New Campaign' }).first().click();
    await page.getByLabel('Campaign Name').fill(`E2E audio ${Date.now()}`);
    await page.getByText('This campaign promotes a sound').click();
  });

  test('puts each link in its own field, whichever box it is pasted into', async ({ page }) => {
    const asked = await answerChecks(page);
    const tiktok = page.getByLabel('TikTok sound', { exact: true });
    const instagram = page.getByLabel('Instagram audio', { exact: true });
    const spotify = page.getByLabel('Spotify link', { exact: true });
    const create = page.getByRole('button', { name: /Create Campaign/ });

    await paste(tiktok, INSTAGRAM_AUDIO);
    await expect(instagram).toHaveValue(INSTAGRAM_AUDIO);
    await expect(tiktok).toHaveValue('');
    await expect(page.getByTestId('instagram-audio-found')).toContainText('≈2M reels');

    await paste(instagram, SPOTIFY_TRACK);
    await expect(spotify).toHaveValue(SPOTIFY_TRACK);
    await expect(instagram).toHaveValue(INSTAGRAM_AUDIO);
    await expect(page.getByTestId('spotify-link-found')).toContainText('Runaway');

    await spotify.fill(TIKTOK_SOUND);
    await spotify.blur();
    await expect(tiktok).toHaveValue(TIKTOK_SOUND);
    await expect(spotify).toHaveValue('');
    await expect(page.getByText('1,200,000 videos')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0);

    expect(asked).toEqual([INSTAGRAM_AUDIO, TIKTOK_SOUND]);
    // In the dialog: the page keeps Next's route announcer, an empty alert, outside it.
    await expect(page.getByRole('dialog', { name: 'New Campaign' }).getByRole('alert')).toHaveCount(0);
    await expect(create).toBeEnabled();
  });

  test('leaves out what cannot be tracked, says why, and keeps Create open', async ({ page }) => {
    await answerChecks(page);
    const instagram = page.getByLabel('Instagram audio', { exact: true });
    const create = page.getByRole('button', { name: /Create Campaign/ });

    await paste(instagram, ORIGINAL_AUDIO);
    await expect(page.getByTestId('audio-link-not-added')).toContainText("Not added. That's original audio.");
    await expect(instagram).toHaveValue('');
    await expect(create).toBeEnabled();

    // Over a good audio, the good one stays.
    await paste(instagram, INSTAGRAM_AUDIO);
    await expect(page.getByTestId('instagram-audio-found')).toContainText('Runaway');
    await paste(instagram, ORIGINAL_AUDIO);
    await expect(page.getByTestId('audio-link-not-added')).toContainText("That's original audio.");
    await expect(page.getByTestId('audio-link-not-added')).toContainText('The link already in this field stays.');
    await expect(instagram).toHaveValue(INSTAGRAM_AUDIO);
    await expect(page.getByTestId('instagram-audio-found')).toContainText('Runaway');

    await paste(page.getByLabel('Spotify link', { exact: true }), `https://open.spotify.com/album/69bRMupnNveGN0PbZNoctn`);
    await expect(page.getByText("That's an album link. Open the song and copy its link.")).toBeVisible();
    await expect(page.getByLabel('Spotify link', { exact: true })).toHaveValue('');
    await expect(create).toBeEnabled();
  });
});

test.describe('Campaign audio in settings', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1?section=edit');
  });

  test('hands a link to its own section, and leaves out what cannot be tracked', async ({ page }) => {
    await answerChecks(page);
    const tiktokSection = page.getByRole('region', { name: 'TikTok sound' });
    const spotifySection = page.getByRole('region', { name: 'Spotify track' });
    await expect(tiktokSection).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('region', { name: 'Instagram audio' })).toBeVisible();
    await expect(spotifySection).toBeVisible();

    await tiktokSection.getByRole('button', { name: 'Add TikTok sound' }).click();
    await paste(page.getByLabel('TikTok sound link'), INSTAGRAM_AUDIO);
    const instagramSlot = page.getByRole('region', { name: 'Add Instagram audio' });
    await expect(instagramSlot.getByTestId('audio-link-moved')).toContainText('Moved here from TikTok sound.');
    await expect(instagramSlot.getByText(/STEP 2 OF 3/)).toBeVisible();
    await expect(instagramSlot.getByText('Runaway')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add TikTok sound' })).toBeVisible();
    await instagramSlot.getByRole('button', { name: 'Back' }).click();

    await paste(instagramSlot.getByLabel('Instagram audio link'), ORIGINAL_AUDIO);
    await expect(instagramSlot.getByTestId('audio-link-not-added')).toContainText("That's original audio.");
    await expect(instagramSlot.getByLabel('Instagram audio link')).toHaveValue('');
    await instagramSlot.getByRole('button', { name: 'Cancel' }).click();

    const spotify = spotifySection.getByLabel('Spotify link');
    await paste(spotify, `https://open.spotify.com/artist/69bRMupnNveGN0PbZNoctn`);
    await expect(spotifySection.getByTestId('audio-link-not-added')).toContainText("That's an artist link.");
    await expect(spotify).toHaveValue('');
    await expect(spotifySection.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
