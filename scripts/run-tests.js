#!/usr/bin/env node

/**
 * Master Test Runner
 * Runs all test suites: unit, integration, and e2e
 *
 * Usage: node scripts/run-tests.js [options]
 *   --unit-only        Run only unit/integration tests
 *   --e2e-only        Run only e2e tests (requires dev server)
 *   --coverage        Collect coverage (unit tests only)
 *   --ci              CI mode (skips starting dev server automatically, uses E2E_BASE_URL)
 *
 * Examples:
 *   node scripts/run-tests.js          # Run all tests
 *   node scripts/run-tests.js --unit-only --coverage
 */

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const isUnitOnly = args.includes('--unit-only');
const isE2eOnly = args.includes('--e2e-only');
const wantCoverage = args.includes('--coverage') || args.includes('--coverage');
const isCI = args.includes('--ci') || process.env.CI === 'true';

const rootDir = path.resolve(__dirname, '..');
let exitCode = 0;

function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function checkPrerequisites() {
  // Check if DATABASE_URL is set for integration tests
  const { env } = process;
  if (!env.DATABASE_URL && !isE2eOnly) {
    console.warn('⚠️  DATABASE_URL not set. Integration tests may fail or use mocks.');
    console.warn('   Set DATABASE_URL in .env.test for full integration testing.');
  }
}

async function runUnitTests() {
  console.log('\n🧪 Running Unit & Integration Tests...\n');
  try {
    const unitArgs = ['--config', 'jest.config.js'];
    if (wantCoverage) unitArgs.push('--coverage');
    await runCommand('npx', unitArgs);
    console.log('✅ Unit & Integration tests passed');
  } catch (err) {
    console.error('❌ Unit & Integration tests failed');
    exitCode = 1;
  }
}

async function runE2ETests() {
  if (!isE2eOnly) {
    // Start dev server in background for E2E tests
    console.log('\n🚀 Starting dev server for E2E tests...\n');
    const devServer = spawn('npm', ['run', 'dev'], {
      cwd: rootDir,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    devServer.stdout?.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      if (text.includes('Ready in')) {
        // Server is ready
      }
    });

    devServer.stderr?.on('data', (data) => {
      process.stderr.write(data);
    });

    // Wait a bit for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log('\n🌐 Running E2E Tests with Playwright...\n');
  try {
    const e2eArgs = ['test', '--config=playwright.config.ts'];
    await runCommand('npx', e2eArgs);
    console.log('✅ E2E tests passed');
  } catch (err) {
    console.error('❌ E2E tests failed');
    exitCode = 1;
  } finally {
    if (!isE2eOnly && !isCI) {
      // Kill dev server (best effort)
      // In CI, dev server is managed by playwright webServer
      console.log('\n🛑 Shutting down dev server...');
    }
  }
}

(async () => {
  console.log('─────────────────────────────────────');
  console.log('   CreatorCore Test Automation');
  console.log('─────────────────────────────────────\n');

  try {
    await checkPrerequisites();

    if (!isE2eOnly) {
      await runUnitTests();
    }

    if (!isUnitOnly) {
      await runE2ETests();
    }

    if (exitCode === 0) {
      console.log('\n─────────────────────────────────────');
      console.log('   ✅ All tests passed!');
      console.log('─────────────────────────────────────\n');
    } else {
      console.log('\n─────────────────────────────────────');
      console.log('   ❌ Some tests failed');
      console.log('─────────────────────────────────────\n');
    }

    process.exit(exitCode);
  } catch (err) {
    console.error('Test runner error:', err);
    process.exit(1);
  }
})();
