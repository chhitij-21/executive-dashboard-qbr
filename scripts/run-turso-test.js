// scripts/run-turso-test.js
// Cross-platform Node runner for Turso parity test mode (Item #16)

'use strict';

const { spawnSync } = require('child_process');

const env = { ...process.env, TEST_USE_TURSO: 'true' };
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('[test:turso] Running test suite against Turso database...');
const result = spawnSync(npmCmd, ['test'], {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status || 0);
