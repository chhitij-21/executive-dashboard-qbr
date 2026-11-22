// scripts/cleanup-test-artifacts.js
// Sweeps orphaned test SQLite databases and temporary directories left by crashes or OOM.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.resolve(__dirname, '../data');

function cleanDataDir() {
  if (!fs.existsSync(DATA_DIR)) return;

  const entries = fs.readdirSync(DATA_DIR);
  for (const entry of entries) {
    if (entry.startsWith('test-') && (entry.endsWith('.db') || entry.endsWith('.db-wal') || entry.endsWith('.db-shm'))) {
      const fullPath = path.join(DATA_DIR, entry);
      try {
        fs.unlinkSync(fullPath);
      } catch (_) {}
    }
    if (entry.startsWith('test-tenants-')) {
      const fullPath = path.join(DATA_DIR, entry);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}

function cleanTmpDir() {
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (entry.startsWith('test-tenants-')) {
        try {
          fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
        } catch (_) {}
      }
      if (entry.startsWith('vuln-') && entry.endsWith('.json')) {
        try {
          fs.unlinkSync(path.join(tmpDir, entry));
        } catch (_) {}
      }
    }
  } catch (_) {}
}

cleanDataDir();
cleanTmpDir();
