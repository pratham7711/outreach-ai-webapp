import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const portalAuthFile = path.join(__dirname, '.portal-auth.json');

setup('authenticate as creator portal user', async ({ request }) => {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3009';

  // Login via the portal auth API to get a session cookie
  const response = await request.post(`${baseURL}/api/portal/auth/login`, {
    data: { email: 'creator@demo.com', password: 'creator123' },
  });

  if (!response.ok()) {
    throw new Error(`Portal login failed: ${response.status()} ${await response.text()}`);
  }

  // Extract the creator_portal_token cookie from the response
  const cookies = await request.storageState();

  // Ensure the cookie was set
  const portalCookie = cookies.cookies.find(c => c.name === 'creator_portal_token');
  if (!portalCookie) {
    throw new Error('creator_portal_token cookie not set after login');
  }

  fs.mkdirSync(path.dirname(portalAuthFile), { recursive: true });
  fs.writeFileSync(portalAuthFile, JSON.stringify(cookies, null, 2));
});
