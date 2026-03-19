const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

/** Integration-test config — runs API route handlers in a node environment */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.node.js'],
  testEnvironment: 'node',
  testMatch: ['**/__tests__/integration/**/*.test.(ts|tsx|js|jsx)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = createJestConfig(customJestConfig);
