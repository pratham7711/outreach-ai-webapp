import '@testing-library/jest-dom';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
    toString: jest.fn(),
  }),
  usePathname: () => '/',
}));

// Mock next-auth
jest.mock('next-auth', () => ({
  getSession: jest.fn(() => Promise.resolve({ user: { id: 'test' } })),
  signIn: jest.fn(() => Promise.resolve({})),
  signOut: jest.fn(() => Promise.resolve()),
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Silence console.warn/error for React 19 deprecations in tests (optional)
const originalWarn = console.warn;
const originalError = console.error;
beforeAll(() => {
  console.warn = (...args) => {
    if (typeof args[0]?.includes?.('React does not recognize the') && args[0]?.includes?.('onDoubleClick')) {
      return;
    }
    originalWarn(...args);
  };
  console.error = (...args) => {
    if (typeof args[0]?.includes?.('React does not recognize the') && args[0]?.includes?.('onDoubleClick')) {
      return;
    }
    originalError(...args);
  };
});
afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
