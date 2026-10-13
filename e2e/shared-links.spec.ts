import { test, expect, type Browser, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { collectPageErrors, unexpectedErrors, expectNoHorizontalScroll, waitForHydration, LOGIN_EMAIL_FIELD, PHONE } from './helpers';

/*
 * The links an agency hands to someone outside it -- a creator's connect link,
 * a campaign invitation, a shared list -- and the two dashboard pages those
 * flows start from that no spec opened: a list's own page and a song's.
 *
 * Everything here runs in an org made for this run, not the seeded demo org.
 * Each of these links has to be minted first, and every one of them would
 * change a page the contrast ratchet scores in the demo org: a connect link
 * shows on /creators/creator-1, a share on /lists, a song turns /songs from
 * its empty state into a grid. The ratchet fails on pairs that appear AND on
 * pairs that vanish, so it would then pass or fail depending on whether this
 * file ran before it. A fresh org changes nothing anyone else asserts on.
 *
 * Nothing here contacts anybody. Signup mail goes to example.com, which RFC
 * 2606 reserves, and this suite runs with no mail provider configured; the
 * links are opened by this test and by no one else.
 */
test.describe.configure({ mode: 'serial' });

type Fixture = {
  agency: string;
  creatorName: string;
  campaignTitle: string;
  listName: string;
  songTitle: string;
  songArtist: string;
  listId: string;
  songId: string;
  connectPath: string;
  invitePath: string;
  listSharePath: string;
};

let session: BrowserContext;
let made: Fixture;

async function json<T>(res: Awaited<ReturnType<APIRequestContext['post']>>, what: string): Promise<T> {
  expect(res.status(), `${what}: ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

async function signedOut(browser: Browser) {
  return browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: PHONE });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120000);
  const epoch = Date.now();
  const email = `e2e-links-${epoch}@example.com`;
  const password = 'E2e-links-password-1';
  const agency = `E2E Links ${epoch}`;

  session = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const signup = await session.request.post('/api/signup', {
    data: { orgName: agency, name: 'E2E Links Owner', email, password },
  });
  expect(signup.status(), await signup.text()).toBe(201);

  /* Through the real sign-in form, so the session is one the app issued
     itself. React must own the inputs before they are typed into -- see
     waitForHydration. */
  const page = await session.newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await waitForHydration(page, LOGIN_EMAIL_FIELD);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });
  await page.close();

  /* One after another, not in parallel. MEASURED: sending the four creates
     together took setup from 23s to 17s, and in one run of four the campaign
     create then failed with "Unable to start a transaction in the given time"
     -- a burst of requests against the remote test database outran the 2s
     Prisma waits by default to start one (the route sets no maxWait). Six
     seconds is not worth a flake. */
  const api = session.request;
  const creatorName = 'E2E Links Creator';
  const campaignTitle = `E2E Links Campaign ${epoch}`;
  const listName = `E2E Links List ${epoch}`;
  const songTitle = `E2E Links Song ${epoch}`;
  const songArtist = 'E2E Links Artist';
  const creator = await json<{ id: string }>(
    await api.post('/api/creators', { data: { name: creatorName, handle: `@e2elinks${epoch}`, platform: 'YOUTUBE' } }),
    'create creator',
  );
  const campaign = await json<{ id: string }>(
    await api.post('/api/campaigns', { data: { title: campaignTitle, status: 'IN_PROGRESS' } }),
    'create campaign',
  );
  const list = await json<{ id: string }>(await api.post('/api/lists', { data: { name: listName } }), 'create list');
  const song = await json<{ song: { id: string } }>(
    await api.post('/api/songs', { data: { title: songTitle, artist: songArtist } }),
    'create song',
  );
  const invite = await json<{ invitePath: string }>(
    await api.post(`/api/campaigns/${campaign.id}/invites`, { data: { creatorId: creator.id, channel: 'LINK' } }),
    'create campaign invite',
  );
  const connect = await json<{ path: string }>(
    await api.post(`/api/creators/${creator.id}/connect-link`, { data: {} }),
    'create connect link',
  );
  const added = await api.post(`/api/lists/${list.id}/creators`, { data: { creatorIds: [creator.id] } });
  expect(added.ok(), `add creator to list: ${await added.text()}`).toBe(true);
  const shared = await api.post(`/api/lists/${list.id}/share`, { data: {} });
  expect(shared.ok(), `share list: ${await shared.text()}`).toBe(true);
  const share = ((await shared.json()) as { share: { path: string } | null }).share;
  expect(share?.path, 'the share response carries the public path').toBeTruthy();

  made = {
    agency,
    creatorName,
    campaignTitle,
    listName,
    songTitle,
    songArtist,
    listId: list.id,
    songId: song.song.id,
    connectPath: connect.path,
    invitePath: invite.invitePath,
    listSharePath: share!.path,
  };
});

test.afterAll(async () => {
  await session?.close();
});

test.describe('Signed in, in the new org', () => {
  test("/lists/[id] shows the list and the creator on it", async () => {
    const page = await session.newPage();
    const errors = collectPageErrors(page);
    await page.goto(`/lists/${made.listId}`);
    await expect(page.getByRole('heading', { name: made.listName })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(made.creatorName).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('List not found')).toHaveCount(0);
    expect(unexpectedErrors(errors)).toEqual([]);
    await page.close();
  });

  test('/songs/[id] shows the song', async () => {
    const page = await session.newPage();
    const errors = collectPageErrors(page);
    await page.goto(`/songs/${made.songId}`);
    await expect(page.getByRole('heading', { level: 1, name: made.songTitle })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(made.songArtist).first()).toBeVisible();
    expect(unexpectedErrors(errors)).toEqual([]);
    await page.close();
  });
});

test.describe('Signed out, on a phone', () => {
  test('/l/[token] shows the shared list', async ({ browser }) => {
    const context = await signedOut(browser);
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    await page.goto(made.listSharePath);
    await expect(page.getByRole('heading', { level: 1, name: made.listName })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(made.creatorName).first()).toBeVisible({ timeout: 20000 });
    await expectNoHorizontalScroll(page, '/l/[token] at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
    await context.close();
  });

  test('/connect/[token] asks the creator to connect, naming the agency', async ({ browser }) => {
    const context = await signedOut(browser);
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    await page.goto(made.connectPath);
    await expect(page.getByRole('heading', { level: 1, name: 'Connect your accounts' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(`${made.agency} asked you to connect`)).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
    await expectNoHorizontalScroll(page, '/connect/[token] at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
    await context.close();
  });

  test('/connect/[token] with a dead token says so', async ({ browser }) => {
    const context = await signedOut(browser);
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    /* Well formed -- 43 base64url characters, the shape a real one has -- and
       bound to nothing. */
    await page.goto(`/connect/${'A'.repeat(43)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'This link is no longer active' })).toBeVisible({
      timeout: 30000,
    });
    await expectNoHorizontalScroll(page, '/connect/[dead token] at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
    await context.close();
  });

  test('/invite/[code] shows the campaign and the two answers', async ({ browser }) => {
    const context = await signedOut(browser);
    const page = await context.newPage();
    const errors = collectPageErrors(page);
    await page.goto(made.invitePath);
    await expect(page.getByRole('heading', { level: 1, name: made.campaignTitle })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Accept', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Not for me', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page, '/invite/[code] at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
    await context.close();
  });
});
