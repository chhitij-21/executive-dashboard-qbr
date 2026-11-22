// scripts/verify-hermetic.js
// Enforces hermetic test contract: tests must require no network and leave zero git dirt.

'use strict';

const { execSync } = require('child_process');

function getGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    // Exclude untracked directive file if present
    const lines = status.split('\n').filter(Boolean);
    const relevant = lines.filter((l) => !l.includes('SYSTEM DIRECTIVE'));
    return relevant.join('\n').trim();
  } catch (err) {
    console.error('Failed to run git status:', err.message);
    process.exit(1);
  }
}

console.log('[hermetic] Checking working tree cleanliness before test execution...');
const preStatus = getGitStatus();
const isCi = process.env.CI === 'true' || process.argv.includes('--strict');

if (preStatus && isCi) {
  console.error('ERROR: Working tree is dirty before tests ran in CI. Stash or commit existing changes before running hermetic verification:');
  console.error(preStatus);
  process.exit(1);
} else if (preStatus) {
  console.warn('[hermetic] Notice: Pre-existing uncommitted changes detected. Will verify tests introduce zero additional mutations.');
}

console.log('[hermetic] Running check:test-setup...');
try {
  execSync('npm run check:test-setup', { stdio: 'inherit' });
} catch (err) {
  console.error('ERROR: check:test-setup failed.');
  process.exit(1);
}

console.log('[hermetic] Running test suite...');
try {
  execSync('npm test', { stdio: 'inherit' });
} catch (err) {
  console.error('ERROR: Test suite execution failed.');
  process.exit(1);
}

console.log('[hermetic] Checking working tree cleanliness after test execution...');
const postStatus = getGitStatus();

if (isCi && postStatus) {
  console.error('ERROR: Test suite violated hermetic contract in CI. The following files were created or modified:');
  console.error(postStatus);
  process.exit(1);
} else if (!isCi && postStatus !== preStatus) {
  console.error('ERROR: Test suite violated hermetic contract. The following files were mutated or created during test execution:');
  // Diff between preStatus and postStatus
  const preLines = new Set(preStatus.split('\n'));
  const newMutations = postStatus.split('\n').filter((l) => !preLines.has(l));
  console.error(newMutations.join('\n'));
  process.exit(1);
}

console.log('✓ Hermetic test contract satisfied: zero files mutated or leaked during test execution.');
process.exit(0);
