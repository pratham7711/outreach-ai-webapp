/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '@/app/api/activations/[id]/route';

jest.mock('@/lib/db', () => ({
  db: {
    activation: {
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

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── PATCH /api/activations/[id] ─────────────────────────────────────────────

describe('PATCH /api/activations/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/activations/act-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DRAFT_SUBMITTED' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('act-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when activation not found', async () => {
    mockDb.activation.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/activations/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DRAFT_SUBMITTED' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('updates activation status with valid transition', async () => {
    const existing = { id: 'act-1', status: 'AWAITING_DRAFT', campaignId: 'camp-1' };
    const updated = { ...existing, status: 'DRAFT_SUBMITTED' };
    mockDb.activation.findFirst.mockResolvedValue(existing);
    mockDb.activation.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/activations/act-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DRAFT_SUBMITTED' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('act-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('DRAFT_SUBMITTED');
  });

  it('rejects invalid status transition', async () => {
    const existing = { id: 'act-1', status: 'AWAITING_DRAFT', campaignId: 'camp-1' };
    mockDb.activation.findFirst.mockResolvedValue(existing);

    const req = makeRequest('http://localhost/api/activations/act-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETE' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('act-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot transition');
  });

  it('updates feedbackNotes without changing status', async () => {
    const existing = { id: 'act-1', status: 'AWAITING_DRAFT', campaignId: 'camp-1' };
    const updated = { ...existing, feedbackNotes: 'Looks good' };
    mockDb.activation.findFirst.mockResolvedValue(existing);
    mockDb.activation.update.mockResolvedValue(updated);

    const req = makeRequest('http://localhost/api/activations/act-1', {
      method: 'PATCH',
      body: JSON.stringify({ feedbackNotes: 'Looks good' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('act-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.feedbackNotes).toBe('Looks good');
    expect(mockDb.activation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { feedbackNotes: 'Looks good' },
      })
    );
  });
});

// ─── DELETE /api/activations/[id] ────────────────────────────────────────────

describe('DELETE /api/activations/[id]', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/activations/act-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('act-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when activation not found', async () => {
    mockDb.activation.findFirst.mockResolvedValue(null);

    const req = makeRequest('http://localhost/api/activations/nonexistent', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('soft-deletes activation', async () => {
    const existing = { id: 'act-1', status: 'AWAITING_DRAFT', campaignId: 'camp-1' };
    mockDb.activation.findFirst.mockResolvedValue(existing);
    mockDb.activation.update.mockResolvedValue({ ...existing, deletedAt: new Date() });

    const req = makeRequest('http://localhost/api/activations/act-1', { method: 'DELETE' });
    const res = await DELETE(req, makeParams('act-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDb.activation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
  });
});
