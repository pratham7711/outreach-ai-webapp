import { createMocks } from 'node-mocks-http';
import handler from '@/app/api/campaigns/route';
import { prisma } from '@/lib/prisma';

// Mock Prisma client
jest.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

describe('GET /api/campaigns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a list of campaigns', async () => {
    const mockCampaigns = [
      { id: '1', title: 'Campaign A', status: 'DRAFT' },
      { id: '2', title: 'Campaign B', status: 'IN_PROGRESS' },
    ];
    prisma.campaign.findMany = jest.fn().mockResolvedValue(mockCampaigns);

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getJSONData()).toEqual(mockCampaigns);
    expect(res._getStatusCode()).toBe(200);
  });

  it('handles empty list', async () => {
    prisma.campaign.findMany = jest.fn().mockResolvedValue([]);

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getJSONData()).toEqual([]);
  });

  it('handles database errors', async () => {
    prisma.campaign.findMany = jest.fn().mockRejectedValue(new Error('DB error'));

    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toHaveProperty('error');
  });
});

describe('POST /api/campaigns', () => {
  it('creates a new campaign', async () => {
    const newCampaign = { title: 'New Campaign', status: 'DRAFT' };
    const createdCampaign = { id: '3', ...newCampaign };
    prisma.campaign.create = jest.fn().mockResolvedValue(createdCampaign);

    const { req, res } = createMocks({
      method: 'POST',
      body: newCampaign,
    });

    await handler(req, res);

    expect(prisma.campaign.create).toHaveBeenCalledWith({
      data: { ...newCampaign, orgId: expect.any(String) },
    });
    expect(res._getStatusCode()).toBe(201);
    expect(res._getJSONData()).toEqual(createdCampaign);
  });
});
