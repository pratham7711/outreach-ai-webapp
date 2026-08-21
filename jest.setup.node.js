// Minimal setup for integration tests (node environment — no window/DOM)

process.env.TIKTOK_FETCH_MIN_GAP_MS = '0';
process.env.TIKTOK_FETCH_JITTER_MS = '0';
process.env.TIKTOK_FETCH_BREAKER_THRESHOLD = '1000000';

// Mock next-auth for API route tests
jest.mock('next-auth', () => ({
  default: jest.fn(() => ({
    handlers: { GET: jest.fn(), POST: jest.fn() },
    auth: jest.fn(() => Promise.resolve(null)),
    signIn: jest.fn(() => Promise.resolve({})),
    signOut: jest.fn(() => Promise.resolve()),
  })),
}));
