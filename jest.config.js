const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  // Look for tests in __tests__ folders
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js|jsx)'],
  // Transform TypeScript files
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'preserve',
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
      },
    }],
  },
  // Module name mapper for path aliases
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Coverage settings
  collectCoverageFrom: [
    'components/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
};

module.exports = createJestConfig(customJestConfig);

// Projects configuration for unit vs integration separation
// (optional advanced setup shown below - we can keep simple for now)
