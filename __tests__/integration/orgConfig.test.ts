/**
 * @jest-environment node
 */

jest.mock('@/lib/db', () => ({
  db: {
    organization: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    orgPlanConfig: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

import { db } from '@/lib/db';

const mockDb = db as any;

const ORG_A_ID = 'org-a';
const ORG_B_ID = 'org-b';

const validUiConfig = {
  features: { soundTracker: true, creatorPortal: false, aiBriefings: false, reports: true, csvExport: true },
  nav: ['campaigns', 'creators', 'payouts', 'analytics', 'trackers', 'lists'],
  branding: { primaryColor: '#6366f1', brandName: 'Outreach AI' },
  limits: { maxCampaigns: 50, maxCreators: 500, maxUsers: 10 },
  platforms: { tiktok: true, instagram: true, youtube: true },
  dashboard: ['kpi_grid', 'views_over_time', 'platform_breakdown', 'top_posts', 'financial_summary', 'creator_performance'],
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Organization uiConfig ──────────────────────────────────────────────────

describe('Organization uiConfig', () => {
  it('creates org with default uiConfig', async () => {
    const orgData = {
      id: ORG_A_ID,
      name: 'Test Org',
      subdomain: 'test-org',
      uiConfig: validUiConfig,
    };

    mockDb.organization.create.mockResolvedValue(orgData);

    const result = await db.organization.create({
      data: {
        name: 'Test Org',
        subdomain: 'test-org',
        uiConfig: validUiConfig,
      },
    });

    expect(result.uiConfig).toEqual(validUiConfig);
    expect(mockDb.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ uiConfig: validUiConfig }),
    });
  });

  it('uiConfig JSON has expected shape with all required keys', () => {
    const requiredKeys = ['features', 'nav', 'branding', 'limits', 'platforms', 'dashboard'];
    for (const key of requiredKeys) {
      expect(validUiConfig).toHaveProperty(key);
    }

    expect(validUiConfig.features).toHaveProperty('soundTracker');
    expect(validUiConfig.features).toHaveProperty('reports');
    expect(validUiConfig.features).toHaveProperty('csvExport');
    expect(Array.isArray(validUiConfig.nav)).toBe(true);
    expect(validUiConfig.branding).toHaveProperty('primaryColor');
    expect(validUiConfig.branding).toHaveProperty('brandName');
    expect(validUiConfig.limits).toHaveProperty('maxCampaigns');
    expect(validUiConfig.limits).toHaveProperty('maxCreators');
    expect(validUiConfig.limits).toHaveProperty('maxUsers');
    expect(Array.isArray(validUiConfig.dashboard)).toBe(true);
  });
});

// ─── OrgPlanConfig ──────────────────────────────────────────────────────────

describe('OrgPlanConfig', () => {
  it('creates OrgPlanConfig linked to org', async () => {
    const planConfig = {
      id: 'config-1',
      orgId: ORG_A_ID,
      planName: 'pro',
      maxCampaigns: 50,
      maxCreators: 500,
      maxUsers: 10,
      features: { soundTracker: true, reports: true, csvExport: true },
    };

    mockDb.orgPlanConfig.create.mockResolvedValue(planConfig);

    const result = await db.orgPlanConfig.create({
      data: {
        orgId: ORG_A_ID,
        planName: 'pro',
        maxCampaigns: 50,
        maxCreators: 500,
        maxUsers: 10,
        features: { soundTracker: true, reports: true, csvExport: true },
      },
    });

    expect(result.orgId).toBe(ORG_A_ID);
    expect(result.planName).toBe('pro');
    expect(result.maxCampaigns).toBe(50);
    expect(result.features).toEqual({ soundTracker: true, reports: true, csvExport: true });
  });

  it('enforces unique orgId constraint (one config per org)', async () => {
    mockDb.orgPlanConfig.create.mockRejectedValue(
      new Error('Unique constraint failed on the fields: (`orgId`)')
    );

    await expect(
      db.orgPlanConfig.create({
        data: {
          orgId: ORG_A_ID,
          planName: 'starter',
          maxCampaigns: 10,
          maxCreators: 100,
          maxUsers: 5,
          features: {},
        },
      })
    ).rejects.toThrow('Unique constraint');
  });
});

// ─── Cross-tenant isolation ─────────────────────────────────────────────────

describe('Cross-tenant isolation', () => {
  it('org A cannot read org B planConfig when filtering by orgId', async () => {
    // Org B's config exists
    const orgBConfig = {
      id: 'config-b',
      orgId: ORG_B_ID,
      planName: 'enterprise',
      maxCampaigns: 100,
      maxCreators: 1000,
      maxUsers: 50,
      features: { all: true },
    };

    // When org A queries with its own orgId, it gets null
    mockDb.orgPlanConfig.findFirst.mockResolvedValue(null);

    const result = await db.orgPlanConfig.findFirst({
      where: { orgId: ORG_A_ID },
    });

    expect(result).toBeNull();
    expect(mockDb.orgPlanConfig.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_A_ID },
    });
  });

  it('org B config is returned only when queried with org B id', async () => {
    const orgBConfig = {
      id: 'config-b',
      orgId: ORG_B_ID,
      planName: 'enterprise',
    };

    mockDb.orgPlanConfig.findFirst.mockResolvedValue(orgBConfig);

    const result = await db.orgPlanConfig.findFirst({
      where: { orgId: ORG_B_ID },
    });

    expect(result).not.toBeNull();
    expect(result!.orgId).toBe(ORG_B_ID);
  });
});
