/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST as REGISTER } from '@/app/api/portal/auth/register/route';
import { POST as LOGIN } from '@/app/api/portal/auth/login/route';

jest.mock('@/lib/db', () => ({
  db: {
    creatorUser: { findUnique: jest.fn(), create: jest.fn() },
    creatorSession: { create: jest.fn() },
  },
}));

jest.mock('@/lib/creator-auth', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed_pw'),
  verifyPassword: jest.fn(),
  createCreatorSession: jest.fn().mockResolvedValue('tok_123'),
}));

jest.mock('@/lib/portal/creatorEmailVerification', () => ({
  appOrigin: (origin: string) => origin,
  creatorEmailState: jest.fn(),
  clearAbandonedSignup: jest.fn().mockResolvedValue(0),
  issueCreatorVerification: jest.fn().mockResolvedValue({ url: 'http://localhost/portal/verify-email?token=t', sent: true, reused: false }),
}));

import { db } from '@/lib/db';
import { createCreatorSession, verifyPassword } from '@/lib/creator-auth';
import { creatorEmailState, issueCreatorVerification } from '@/lib/portal/creatorEmailVerification';

const mockDb = db as any;
const mockVerify = verifyPassword as jest.Mock;
const mockSession = createCreatorSession as jest.Mock;
const mockState = creatorEmailState as jest.Mock;
const mockIssue = issueCreatorVerification as jest.Mock;

function makeRequest(url: string, body: object) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mockResolvedValue('verified');
});

describe('POST /api/portal/auth/register', () => {
  it('creates the account, mails the confirmation link and opens no session', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue(null);
    mockDb.creatorUser.create.mockResolvedValue({ id: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'testcreator' });

    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'test@x.com', password: 'password123', name: 'Test', handle: 'testcreator',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ email: 'test@x.com', verification: 'sent' });
    expect(mockIssue).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@x.com' }));
    expect(mockSession).not.toHaveBeenCalled();
  });

  it('returns 409 when email already taken', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValueOnce({ id: 'existing' });

    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'taken@x.com', password: 'password123', name: 'Test', handle: 'newhandle',
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).needsVerification).toBeUndefined();
  });

  it('points an unconfirmed email back at its link instead of a dead end', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValueOnce({ id: 'existing' });
    mockState.mockResolvedValue('unverified');

    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'taken@x.com', password: 'password123', name: 'Test', handle: 'newhandle',
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needsVerification: true, email: 'taken@x.com' });
  });

  it('answers 503 while the confirmation table is not there yet, creating nothing', async () => {
    mockState.mockResolvedValue('unavailable');

    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'test@x.com', password: 'password123', name: 'Test', handle: 'testcreator',
    }));
    expect(res.status).toBe(503);
    expect(mockDb.creatorUser.create).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid input', async () => {
    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'bad', password: '123',
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/portal/auth/login', () => {
  it('returns user on valid credentials', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue({
      id: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'testcreator', passwordHash: 'hashed',
    });
    mockVerify.mockResolvedValue(true);

    const res = await LOGIN(makeRequest('http://localhost/api/portal/auth/login', {
      email: 'test@x.com', password: 'password123',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handle).toBe('testcreator');
    expect(mockSession).toHaveBeenCalledWith('cu-1');
  });

  it('refuses a session to an unconfirmed email and re-sends its link', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue({
      id: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'testcreator', passwordHash: 'hashed',
    });
    mockVerify.mockResolvedValue(true);
    mockState.mockResolvedValue('unverified');

    const res = await LOGIN(makeRequest('http://localhost/api/portal/auth/login', {
      email: 'test@x.com', password: 'password123',
    }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ needsVerification: true, email: 'test@x.com' });
    expect(mockIssue).toHaveBeenCalledTimes(1);
    expect(mockSession).not.toHaveBeenCalled();
  });

  it('never reveals confirmation state to a wrong password', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue({ id: 'cu-1', email: 'test@x.com', passwordHash: 'hashed' });
    mockVerify.mockResolvedValue(false);
    mockState.mockResolvedValue('unverified');

    const res = await LOGIN(makeRequest('http://localhost/api/portal/auth/login', {
      email: 'test@x.com', password: 'wrong',
    }));
    expect(res.status).toBe(401);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('returns 401 for wrong password', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue({
      id: 'cu-1', email: 'test@x.com', passwordHash: 'hashed',
    });
    mockVerify.mockResolvedValue(false);

    const res = await LOGIN(makeRequest('http://localhost/api/portal/auth/login', {
      email: 'test@x.com', password: 'wrong',
    }));
    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent email', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue(null);

    const res = await LOGIN(makeRequest('http://localhost/api/portal/auth/login', {
      email: 'nobody@x.com', password: 'password123',
    }));
    expect(res.status).toBe(401);
  });
});
