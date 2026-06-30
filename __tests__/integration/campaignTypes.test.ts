/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/campaigns/route';
import { GET as GETById, PATCH } from '@/app/api/campaigns/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    campaign: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  auth: jest.fn(),
}));

import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: 'user-1', orgId: 'org-1' } };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── POST /api/campaigns — campaignType handling ─────────────────────────────

describe('POST /api/campaigns — campaignType', () => {
  const baseCampaign = {
    id: 'camp-type-1',
    title: 'Type Test',
    status: 'DRAFT',
    orgId: 'org-1',
    tags: [],
    teamMembers: [],
    _count: { activations: 0, posts: 0 },
  };

  it('creates campaign with explicit campaignType', async () => {
    mockDb.campaign.create.mockResolvedValue({
      ...baseCampaign,
      campaignType: 'VIEW_BASED',
      typeConfig: null,
    });

    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'Type Test', campaignType: 'VIEW_BASED' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockDb.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignType: 'VIEW_BASED',
        }),
      })
    );
    expect(body.campaignType).toBe('VIEW_BASED');
  });

  it('defaults to BUDGET_BASED when campaignType not specified', async () => {
    mockDb.campaign.create.mockResolvedValue({
      ...baseCampaign,
      campaignType: 'BUDGET_BASED',
      typeConfig: null,
    });

    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'Default Type' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockDb.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignType: 'BUDGET_BASED',
        }),
      })
    );
  });

  it('rejects invalid campaignType', async () => {
    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bad Type', campaignType: 'INVALID_TYPE' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input');
  });

  it('accepts typeConfig along with campaignType', async () => {
    const typeConfig = { minViews: 10000, targetPlatform: 'TIKTOK' };
    mockDb.campaign.create.mockResolvedValue({
      ...baseCampaign,
      campaignType: 'VIEW_BASED',
      typeConfig,
    });

    const req = makeRequest('http://localhost/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ title: 'Config Test', campaignType: 'VIEW_BASED', typeConfig }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockDb.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignType: 'VIEW_BASED',
          typeConfig,
        }),
      })
    );
  });
});

// ─── PATCH /api/campaigns/[id] — campaignType handling ───────────────────────

describe('PATCH /api/campaigns/[id] — campaignType', () => {
  it('updates campaignType', async () => {
    const updated = {
      id: 'camp-1',
      title: 'Test',
      campaignType: 'OPEN_COMMUNITY',
      tags: [],
      teamMembers: [],
      _count: { activations: 0, posts: 0 },
    };
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1' });
    mockDb.campaign.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ campaignType: 'OPEN_COMMUNITY' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaignType).toBe('OPEN_COMMUNITY');
    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignType: 'OPEN_COMMUNITY',
        }),
      })
    );
  });

  it('rejects invalid campaignType on PATCH', async () => {
    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ campaignType: 'NOT_A_TYPE' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));

    expect(res.status).toBe(400);
  });

  it('updates typeConfig via PATCH', async () => {
    const typeConfig = { maxCreators: 50 };
    mockDb.campaign.findFirst.mockResolvedValue({ id: 'camp-1', orgId: 'org-1' });
    mockDb.campaign.update.mockResolvedValue({
      id: 'camp-1',
      typeConfig,
      tags: [],
      teamMembers: [],
      _count: { activations: 0, posts: 0 },
    });

    const req = makeRequest('http://localhost/api/campaigns/camp-1', {
      method: 'PATCH',
      body: JSON.stringify({ typeConfig }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('camp-1'));

    expect(res.status).toBe(200);
    expect(mockDb.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ typeConfig }),
      })
    );
  });
});

// ─── GET /api/campaigns/[id] — returns campaignType ──────────────────────────

describe('GET /api/campaigns/[id] — campaignType', () => {
  it('returns campaignType field in response', async () => {
    const campaign = {
      id: 'camp-1',
      title: 'Test',
      campaignType: 'PRIVATE_INVITE',
      typeConfig: { inviteCode: 'ABC123' },
      deletedAt: null,
      _count: { activations: 0, posts: 0 },
    };
    mockDb.campaign.findFirst.mockResolvedValue(campaign);

    const req = makeRequest('http://localhost/api/campaigns/camp-1');
    const res = await GETById(req, makeParams('camp-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaignType).toBe('PRIVATE_INVITE');
    expect(body.typeConfig).toEqual({ inviteCode: 'ABC123' });
  });
});

// ─── GET /api/campaigns — list returns campaignType ──────────────────────────

describe('GET /api/campaigns — list includes campaignType', () => {
  it('returns campaignType in campaign list', async () => {
    const campaigns = [
      {
        id: '1',
        title: 'A',
        status: 'DRAFT',
        campaignType: 'VIEW_BASED',
        tags: [],
        teamMembers: [],
        _count: { activations: 0, posts: 0 },
      },
    ];
    mockDb.campaign.findMany.mockResolvedValue(campaigns);
    mockDb.campaign.count.mockResolvedValue(1);

    const req = makeRequest('http://localhost/api/campaigns');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaigns[0].campaignType).toBe('VIEW_BASED');
  });
});
