// Minimal setup for integration tests (node environment — no window/DOM)

/* The application logger writes to stdout, and a suite that fills stdout with
   tens of thousands of log lines has its output persisted to a file rather than
   returned -- which costs a green run its deploy-gate receipt. Overridable, so a
   test being debugged can still ask for the logs back. */
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

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
