# Testing Setup for CreatorCore

This document outlines the testing setup including:
- Unit & Integration Tests: Jest + Testing Library
- E2E Tests: Playwright
- Automation Script: `scripts/run-tests.js`

## Quick Start

```bash
# Install all testing dependencies
npm run test:install

# Run all tests
npm run test

# Run specific test suites
npm run test:unit     # Unit + integration
npm run test:e2e      # Playwright E2E
npm run test:watch    # Watch mode for unit tests

# Generate test coverage report
npm run test:coverage
```

## Test Structure

```
webapp/
├── __tests__/
│   ├── unit/              # Component/unit tests
│   │   ├── components/
│   │   │   ├── CampaignCard.test.tsx
│   │   │   └── Navbar.test.tsx
│   │   ├── lib/
│   │   │   └── prisma.test.ts
│   │   └── utils/
│   │       └── cn.test.ts
│   └── integration/       # API route + integration tests
│       ├── auth.test.ts
│       ├── campaigns.test.ts
│       └── creators.test.ts
├── e2e/                   # Playwright E2E tests
│   ├── auth.spec.ts
│   ├── campaigns.spec.ts
│   └── creators.spec.ts
├── jest.config.js
├── playwright.config.ts
├── scripts/
│   └── run-tests.js      # Master test runner
└── package.json scripts
```

## Writing New Tests

### Unit Tests (Jest + React Testing Library)

```tsx
// __tests__/unit/components/CampaignCard.test.tsx
import { render, screen } from '@testing-library/react';
import CampaignCard from '@/components/CampaignCard';

describe('CampaignCard', () => {
  it('displays campaign title', () => {
    const campaign = { id: '1', title: 'Summer Launch', status: 'DRAFT' };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByText('Summer Launch')).toBeInTheDocument();
  });
});
```

### Integration Tests (API)

```ts
// __tests__/integration/campaigns.test.ts
import { createMocks } from 'node-mocks-http';
import handler from '@/app/api/campaigns/route';
import { prisma } from '@/lib/prisma';

// Use a separate test database or mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

describe('GET /api/campaigns', () => {
  it('returns list of campaigns', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);
    expect(res._getJSONData()).toBeDefined();
  });
});
```

### E2E Tests (Playwright)

```ts
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
  test('should navigate to login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should show login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText('Sign in');
  });
});
```

## Environment Variables for Tests

Create `.env.test`:

```env
# Use a separate test database or override for CI
DATABASE_URL="postgresql://postgres:test-pass@localhost:5432/creatorcore_test"
NEXTAUTH_SECRET="test-secret"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Master Automation Script

The `scripts/run-tests.js` script will:
1. Check prerequisites (DB running, env vars)
2. Run unit tests with coverage
3. Run integration tests (optionally against test DB)
4. Start dev server in background
5. Run Playwright E2E tests
6. Collect and print summary
7. Exit with appropriate code

## Keep Tests Updated

As you develop:
- Add unit tests for every new component/utility function
- Add integration tests for every new API route
- Add E2E tests for every new user flow
- Update existing tests when behavior changes
- Keep this README in sync

## Notes

- Unit tests should be fast (< 500ms each)
- Integration tests should use a test database or mocks
- E2E tests should be run in CI and before major releases
- Avoid flaky tests; if a test is flaky, fix or skip it
