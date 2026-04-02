#!/usr/bin/env node

/**
 * Master Test Runner — Outreach AI
 *
 * Usage: node scripts/run-tests.js [options]
 *   --unit-only          Run only unit tests (jest.config.js)
 *   --integration-only   Run only integration tests (jest.integration.config.js)
 *   --e2e-only           Run only E2E tests (requires dev server running)
 *   --coverage           Collect coverage (unit tests only)
 *   --ci                 CI mode (uses E2E_BASE_URL, skips manual server start)
 *
 * Examples:
 *   node scripts/run-tests.js              # Run all tests
 *   node scripts/run-tests.js --e2e-only   # Run only Playwright E2E
 *   node scripts/run-tests.js --integration-only
 *   node scripts/run-tests.js --unit-only --coverage
 */

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const isUnitOnly = args.includes('--unit-only');
const isIntegrationOnly = args.includes('--integration-only');
const isE2eOnly = args.includes('--e2e-only');
const wantCoverage = args.includes('--coverage');
const isCI = args.includes('--ci') || process.env.CI === 'true';

const rootDir = path.resolve(__dirname, '..');
const results = { unit: null, integration: null, e2e: null };

// Clean shutdown on signals
function cleanup() {
  console.log('\nShutting down...');
  process.exit(1);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function runCommand(cmd, cmdArgs = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, cmdArgs, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function runUnitTests() {
  console.log('\n--- Unit Tests ---\n');
  try {
    const unitArgs = ['jest', '--config', 'jest.config.js'];
    if (wantCoverage) unitArgs.push('--coverage');
    await runCommand('npx', unitArgs);
    results.unit = 'PASS';
  } catch {
    results.unit = 'FAIL';
  }
}

async function runIntegrationTests() {
  console.log('\n--- Integration Tests ---\n');
  if (!process.env.DATABASE_URL) {
    console.warn('  DATABASE_URL not set. Integration tests may use mocks.\n');
  }
  try {
    await runCommand('npx', ['jest', '--config', 'jest.integration.config.js']);
    results.integration = 'PASS';
  } catch {
    results.integration = 'FAIL';
  }
}

async function runE2ETests() {
  console.log('\n--- E2E Tests (Playwright) ---\n');
  try {
    await runCommand('npx', ['playwright', 'test', '--config=playwright.config.ts']);
    results.e2e = 'PASS';
  } catch {
    results.e2e = 'FAIL';
  }
}

function printSummary() {
  console.log('\n========================================');
  console.log('         Test Results Summary');
  console.log('========================================');
  for (const [suite, result] of Object.entries(results)) {
    if (result === null) continue;
    const icon = result === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`  ${suite.padEnd(15)} ${icon}`);
  }
  console.log('========================================\n');

  const failed = Object.values(results).some(r => r === 'FAIL');
  if (failed) {
    console.log('  Some test suites failed.\n');
  } else {
    console.log('  All test suites passed.\n');
  }
  return failed ? 1 : 0;
}

(async () => {
  console.log('========================================');
  console.log('   Outreach AI — Test Automation');
  console.log('========================================');

  if (isUnitOnly) {
    await runUnitTests();
  } else if (isIntegrationOnly) {
    await runIntegrationTests();
  } else if (isE2eOnly) {
    await runE2ETests();
  } else {
    // Run all suites
    await runUnitTests();
    await runIntegrationTests();
    await runE2ETests();
  }

  const exitCode = printSummary();
  process.exit(exitCode);
})();
