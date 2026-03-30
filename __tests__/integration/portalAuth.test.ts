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

import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/creator-auth';

const mockDb = db as any;
const mockVerify = verifyPassword as jest.Mock;

function makeRequest(url: string, body: object) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/portal/auth/register', () => {
  it('creates creator user and returns 201', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValue(null);
    mockDb.creatorUser.create.mockResolvedValue({ id: 'cu-1', email: 'test@x.com', name: 'Test', handle: 'testcreator' });

    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'test@x.com', password: 'password123', name: 'Test', handle: 'testcreator',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.handle).toBe('testcreator');
  });

  it('returns 409 when email already taken', async () => {
    mockDb.creatorUser.findUnique.mockResolvedValueOnce({ id: 'existing' });

    const res = await REGISTER(makeRequest('http://localhost/api/portal/auth/register', {
      email: 'taken@x.com', password: 'password123', name: 'Test', handle: 'newhandle',
    }));
    expect(res.status).toBe(409);
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
