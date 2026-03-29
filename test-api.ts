#!/usr/bin/env tsx
// Full API test for Outreach AI (localhost:3009)
import fetch from "node-fetch";

const BASE = "http://localhost:3009";
let cookie = "";

async function post(path: string, body: any) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 200) {
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
  }
  return res;
}

async function get(path: string) {
  return fetch(BASE + path, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

async function testBackend() {
  // 1. Login
  console.log("1) POST /api/auth/callback/credentials");
  const loginRes = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@demo.com",
      password: "admin123",
      csrfToken: "",
      callbackUrl: BASE + "/campaigns",
    }),
    redirect: "manual",
  });
  if (loginRes.status !== 302) throw new Error(`Login failed: ${loginRes.status}`);
  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) throw new Error("No cookie on login");
  cookie = setCookie.split(";")[0];
  console.log("   Logged in, cookie obtained.");

  // 2. GET campaigns
  console.log("2) GET /api/campaigns");
  let res = await get("/api/campaigns");
  if (res.status !== 200) throw new Error(`Campaigns list failed: ${res.status}`);
  let campaigns = (await res.json()) as Array<{ id: string; orgId: number }>;
  console.log(`   Found ${campaigns.length} campaigns`);
  if (campaigns.length === 0) throw new Error("Expected seeded campaigns");

  // 3. GET creators
  console.log("3) GET /api/creators");
  res = await get("/api/creators");
  if (res.status !== 200) throw new Error(`Creators list failed: ${res.status}`);
  const creators = (await res.json()) as Array<{ id: string }>;
  console.log(`   Found ${creators.length} creators`);

  // 4. GET clients
  console.log("4) GET /api/clients");
  res = await get("/api/clients");
  if (res.status !== 200) throw new Error(`Clients list failed: ${res.status}`);
  const clients = (await res.json()) as Array<{ id: string }>;
  console.log(`   Found ${clients.length} clients`);

  // 5. GET payouts
  console.log("5) GET /api/payouts");
  res = await get("/api/payouts");
  if (res.status !== 200) throw new Error(`Payouts list failed: ${res.status}`);
  const payouts = (await res.json()) as Array<{ id: string }>;
  console.log(`   Found ${payouts.length} payouts`);

  // 6. POST create campaign
  console.log("6) POST /api/campaigns");
  res = await post("/api/campaigns", {
    title: "API Test Campaign",
    status: "DRAFT",
    budget: 5000,
    currency: "USD",
    clientId: clients[0]?.id || undefined,
    orgId: campaigns[0]?.orgId || 1,
  });
  if (res.status !== 200) throw new Error(`Create campaign failed: ${res.status}`);
  const newCampaign = (await res.json()) as { id: string };
  console.log(`   Created campaign id=${newCampaign.id}`);

  // 7. PATCH update campaign
  console.log("7) PATCH /api/campaigns/[id]");
  res = await fetch(BASE + `/api/campaigns/${newCampaign.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ status: "IN_PROGRESS" }),
  });
  if (res.status !== 200) throw new Error(`Update campaign failed: ${res.status}`);
  const updated = (await res.json()) as { status: string };
  console.log(`   Updated status to ${updated.status}`);

  // 8. GET campaign detail
  console.log("8) GET /api/campaigns/[id]");
  res = await get(`/api/campaigns/${newCampaign.id}`);
  if (res.status !== 200) throw new Error(`Campaign detail failed: ${res.status}`);
  const detail = (await res.json()) as { title: string; status: string };
  console.log(`   Detail: ${detail.title} (${detail.status})`);

  // 9. DELETE campaign
  console.log("9) DELETE /api/campaigns/[id]");
  res = await fetch(BASE + `/api/campaigns/${newCampaign.id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (res.status !== 200) throw new Error(`Delete campaign failed: ${res.status}`);
  console.log("   Deleted test campaign");

  // 10. GET /api/plans
  console.log("10) GET /api/plans");
  res = await get("/api/plans");
  if (res.status !== 200) throw new Error(`Plans list failed: ${res.status}`);
  const plans = (await res.json()) as Array<{ id: string }>;
  console.log(`   Found ${plans.length} plans`);

  console.log("\n✅ All backend API tests passed!");
}

testBackend().catch((e) => {
  console.error("❌ Test failed:", e);
  process.exit(1);
});
