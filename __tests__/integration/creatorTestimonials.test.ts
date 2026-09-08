/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/portal/testimonials/route';

jest.mock('@/lib/db', () => ({
  db: {
    creatorTestimonial: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    campaignProposal: { findFirst: jest.fn() },
    campaign: { findUnique: jest.fn() },
  },
}));
jest.mock('@/lib/creator-auth', () => ({ getCreatorSession: jest.fn() }));

import { db } from '@/lib/db';
import { getCreatorSession } from '@/lib/creator-auth';

const mockGetCreatorSession = getCreatorSession as jest.Mock;
const mockDb = db as any;
const creatorSession = { creatorUserId: 'cu-1' };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCreatorSession.mockResolvedValue(creatorSession);
  mockDb.campaign.findUnique.mockResolvedValue({ orgId: 'org-of-campaign' });
});

describe('GET /api/portal/testimonials', () => {
  it('returns 401 when no session', async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/portal/testimonials');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/portal/testimonials', () => {
  it('creates testimonial', async () => {
    mockDb.creatorTestimonial.findFirst.mockResolvedValue(null);
    mockDb.campaignProposal.findFirst.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' });
    mockDb.creatorTestimonial.create.mockResolvedValue({
      id: 't1',
      content: 'Great experience!',
      orgId: 'org-1',
      campaignId: 'camp-1',
    });

    const req = makeRequest('http://localhost/api/portal/testimonials', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        campaignId: 'camp-1',
        content: 'Great experience working with this org!',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('returns 403 when creator was not accepted', async () => {
    mockDb.campaignProposal.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/portal/testimonials', {
      method: 'POST',
      body: JSON.stringify({
        orgId: 'org-1',
        campaignId: 'camp-1',
        content: 'Great experience working with this org!',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

/* orgId used to be a required field on the request body and was written to the
   row verbatim, while authorisation was checked against campaignId alone. A
   creator with one accepted proposal could therefore file a testimonial
   attributed to any org in the system, and it renders on the public creator
   page as an endorsement of a brand they never worked with. */
describe('POST /api/portal/testimonials — attribution', () => {
  const post = (body: Record<string, unknown>) =>
    POST(makeRequest('http://localhost/api/portal/testimonials', {
      method: 'POST',
      body: JSON.stringify(body),
    }));

  beforeEach(() => {
    mockDb.creatorTestimonial.findFirst.mockResolvedValue(null);
    mockDb.campaignProposal.findFirst.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' });
    mockDb.creatorTestimonial.create.mockResolvedValue({ id: 't1' });
  });

  it("stores the campaign's org, not the one on the body", async () => {
    const res = await post({
      orgId: 'org-the-creator-never-worked-with',
      campaignId: 'camp-1',
      content: 'Great experience working with this org!',
    });
    expect(res.status).toBe(201);
    expect(mockDb.creatorTestimonial.create).toHaveBeenCalledWith({
      data: {
        creatorUserId: 'cu-1',
        orgId: 'org-of-campaign',
        campaignId: 'camp-1',
        content: 'Great experience working with this org!',
      },
    });
  });

  it('no longer requires an orgId on the body at all', async () => {
    const res = await post({
      campaignId: 'camp-1',
      content: 'Great experience working with this org!',
    });
    expect(res.status).toBe(201);
  });

  it('404s when the campaign is gone', async () => {
    mockDb.campaign.findUnique.mockResolvedValue(null);
    const res = await post({
      campaignId: 'camp-gone',
      content: 'Great experience working with this org!',
    });
    expect(res.status).toBe(404);
    expect(mockDb.creatorTestimonial.create).not.toHaveBeenCalled();
  });
});
