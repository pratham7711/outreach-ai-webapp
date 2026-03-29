#!/usr/bin/env tsx
// Interactive edge test for Outreach AI (localhost:3009)
// Uses native fetch (Node 18+)

const BASE = 'http://localhost:3009';
let cookie = '';

async function post(path: string, body: any) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  if (res.status === 302 || res.status === 200) {
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
  }
  return res;
}

async function get(path: string) {
  return fetch(BASE + path, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
}

async function testFlow() {
  // 1. Login
  console.log('1) Login...');
  let res = await post('/api/auth/login', { email: 'admin@demo.com', password: 'admin123' });
  if (res.status !== 302) throw new Error(`Login failed: ${res.status}`);
  console.log('   Logged in, cookie:', cookie);

  // 2. GET campaigns (list)
  console.log('2) GET /api/campaigns');
  res = await get('/api/campaigns');
  if (res.status !== 200) throw new Error(`Campaigns list failed: ${res.status}`);
  const campaigns = await res.json();
  console.log(`   Found ${campaigns.length} campaigns`);

  // 3. Create campaign
  console.log('3) POST /api/campaigns');
  res = await post('/api/campaigns', {
    name: 'Test Campaign',
    brief: 'Testing interactive edges',
    clientId: campaigns[0]?.clientId || 1,
    orgId: campaigns[0]?.orgId || 1,
  });
  if (res.status !== 200) throw new Error(`Create campaign failed: ${res.status}`);
  const campaign = await res.json();
  console.log(`   Created campaign id=${campaign.id}`);

  // 4. Get campaign detail
  console.log('4) GET /api/campaigns/[id]');
  res = await get(`/api/campaigns/${campaign.id}`);
  if (res.status !== 200) throw new Error(`Campaign detail failed: ${res.status}`);
  const detail = await res.json();
  console.log(`   Detail: ${detail.name} (status: ${detail.status})`);

  // 5. Update campaign
  console.log('5) PATCH /api/campaigns/[id]');
  res = await fetch(`/api/campaigns/${campaign.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ status: 'Active' }),
  });
  if (res.status !== 200) throw new Error(`Update failed: ${res.status}`);
  const updated = await res.json();
  console.log(`   Updated status to ${updated.status}`);

  // 6. List creators
  console.log('6) GET /api/creators');
  res = await get('/api/creators');
  if (res.status !== 200) throw new Error('Creators list failed');
  const creators = await res.json();
  console.log(`   Found ${creators.length} creators`);

  // 7. Create creator (if needed)
  if (creators.length < 2) {
    console.log('7) POST /api/creators');
    res = await post('/api/creators', {
      name: 'Test Creator',
      email: 'test@example.com',
      platform: 'Instagram',
      followers: 10000,
      orgId: 1,
    });
    if (res.status !== 200) throw new Error('Create creator failed');
    const creator = await res.json();
    console.log(`   Created creator id=${creator.id}`);
  }

  // 8. List clients
  console.log('8) GET /api/clients');
  res = await get('/api/clients');
  if (res.status !== 200) throw new Error('Clients list failed');
  const clients = await res.json();
  console.log(`   Found ${clients.length} clients`);

  // 9. Create client (if needed)
  if (clients.length < 4) {
    console.log('9) POST /api/clients');
    res = await post('/api/clients', {
      name: 'Test Client Corp',
      email: 'client@test.com',
      industry: 'Tech',
      orgId: 1,
    });
    if (res.status !== 200) throw new Error('Create client failed');
    const client = await res.json();
    console.log(`   Created client id=${client.id}`);
  }

  // 10. Payouts
  console.log('10) GET /api/payouts');
  res = await get('/api/payouts');
  if (res.status !== 200) throw new Error('Payouts list failed');
  const payouts = await res.json();
  console.log(`   Found ${payouts.length} payouts`);

  // 11. Create payout
  console.log('11) POST /api/payouts');
  res = await post('/api/payouts', {
    amount: 500,
    currency: 'USD',
    status: 'Pending',
    creatorId: creators[0]?.id || 1,
    campaignId: campaign.id,
    orgId: 1,
  });
  if (res.status !== 200) throw new Error('Create payout failed');
  const payout = await res.json();
  console.log(`   Created payout id=${payout.id}`);

  // 12. Cleanup: delete test campaign
  console.log('12) DELETE /api/campaigns/[id]');
  res = await fetch(`/api/campaigns/${campaign.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  if (res.status !== 200) throw new Error('Delete campaign failed');
  console.log('   Deleted test campaign');

  console.log('\n✅ All interactive edges passed!');
}

testFlow().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
