// scripts/check-test-setup-imports.js
// Enforces that 100% of test files import _setup.js for worker PID isolation.

'use strict';

const fs = require('fs');
const path = require('path');

const TEST_DIRS = [
  path.resolve(__dirname, '../backend/tests'),
  path.resolve(__dirname, '../backend/tests/ai'),
];

let missingCount = 0;

for (const dir of TEST_DIRS) {
  if (!fs.existsSync(dir)) continue;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith('.test.js')) continue;

    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check if file requires _setup
    const hasSetup = /require\(['"][^'"]*\/_setup(\.js)?['"]\)/.test(content);
    if (!hasSetup) {
      console.error(`MISSING _setup.js import: ${path.relative(path.resolve(__dirname, '..'), fullPath)}`);
      missingCount++;
    }
  }
}

if (missingCount > 0) {
  console.error(`\nFound ${missingCount} test file(s) missing _setup.js import. Every test file must import _setup.js to enforce test isolation.`);
  process.exit(1);
} else {
  console.log('✓ All test files properly import _setup.js');
  process.exit(0);
}
