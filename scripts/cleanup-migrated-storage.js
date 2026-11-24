// scripts/cleanup-migrated-storage.js
// Cleanup and Decommissioning Script for Item #2 (Storage Migration)
// Removes local disk files only after verifying exact ETag presence in Turso DB storage.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storageRepo = require('../backend/repositories/storageRepo');

const DATA_DIR = path.resolve(__dirname, '../data');
const REPORTS_DIR = path.resolve(__dirname, '../reports');

/**
 * Discovers candidates on disk that may have been migrated to database storage.
 */
function discoverCleanupCandidates() {
  const candidates = [];

  // 1. Check reports in reports/
  if (fs.existsSync(REPORTS_DIR)) {
    const files = fs.readdirSync(REPORTS_DIR);
    for (const f of files) {
      const fullPath = path.join(REPORTS_DIR, f);
      if (fs.statSync(fullPath).isFile() && f.endsWith('.pptx')) {
        let tenantId = 'client-default';
        if (f.toLowerCase().startsWith('jfl')) tenantId = 'client-jfl';
        if (f.toLowerCase().startsWith('mmtc')) tenantId = 'client-mmtcpamp';

        candidates.push({
          filePath: fullPath,
          tenantId,
          key: `tenants/${tenantId}/reports/legacy/${f}`,
          sizeBytes: fs.statSync(fullPath).size,
        });
      }
    }
  }

  // 2. Check tenant template versions in data/tenants/
  const tenantsDir = path.join(DATA_DIR, 'tenants');
  if (fs.existsSync(tenantsDir)) {
    const tenants = fs.readdirSync(tenantsDir);
    for (const t of tenants) {
      const tPath = path.join(tenantsDir, t);
      if (!fs.statSync(tPath).isDirectory()) continue;

      const versionsDir = path.join(tPath, 'templates', 'versions');
      if (fs.existsSync(versionsDir)) {
        const vFiles = fs.readdirSync(versionsDir);
        for (const vf of vFiles) {
          const vPath = path.join(versionsDir, vf);
          if (fs.statSync(vPath).isFile() && vf.endsWith('.pptx')) {
            candidates.push({
              filePath: vPath,
              tenantId: t,
              key: `tenants/${t}/templates/${vf}`,
              sizeBytes: fs.statSync(vPath).size,
            });
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Executes cleanup dry-run or live file removal.
 * @param {object} options
 * @param {boolean} [options.execute=false]
 */
async function run(options = {}) {
  const isExecute = options.execute !== undefined ? options.execute : process.argv.includes('--execute');
  console.log(`[cleanup-migrated-storage] Mode: ${isExecute ? 'EXECUTE (live disk cleanup)' : 'DRY RUN (preview only)'}`);

  const candidates = discoverCleanupCandidates();
  console.log(`[cleanup-migrated-storage] Scanning ${candidates.length} candidate file(s)...`);

  const verifiedEligible = [];

  for (const c of candidates) {
    try {
      const buf = fs.readFileSync(c.filePath);
      const fileEtag = crypto.createHash('sha256').update(buf).digest('hex');

      // Verify presence and exact ETag match in DB storage
      const stored = await storageRepo.getObject({ tenantId: c.tenantId, key: c.key });
      if (stored && stored.metadata?.etag === fileEtag) {
        verifiedEligible.push(c);
      }
    } catch (_) {}
  }

  const totalBytes = verifiedEligible.reduce((acc, c) => acc + c.sizeBytes, 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);

  console.log(`[cleanup-migrated-storage] Verified ${verifiedEligible.length}/${candidates.length} files matching storage objects (${totalMb} MB eligible for removal).`);

  if (!isExecute) {
    console.log('\n--- DRY RUN CLEANUP PREVIEW ---');
    verifiedEligible.slice(0, 15).forEach((c, i) => {
      console.log(`${i + 1}. [VERIFIED SAFE TO REMOVE] ${c.filePath} (${(c.sizeBytes / 1024).toFixed(1)} KB)`);
    });
    console.log('------------------------------------------------------------');
    console.log('✓ Dry-run completed. Pass --execute to purge local verified copies.');
    return { success: true, eligibleCount: verifiedEligible.length, removedBytes: 0, mode: 'dry-run' };
  }

  // Live removal
  let removedCount = 0;
  let removedBytes = 0;

  for (const c of verifiedEligible) {
    try {
      if (fs.existsSync(c.filePath)) {
        fs.unlinkSync(c.filePath);
        removedCount++;
        removedBytes += c.sizeBytes;
      }
    } catch (err) {
      console.warn(`[cleanup-migrated-storage] Notice deleting ${c.filePath}:`, err.message);
    }
  }

  console.log(`✓ Cleanup complete! Safely removed ${removedCount} files (${(removedBytes / (1024 * 1024)).toFixed(1)} MB reclaimed from local disk).`);
  return { success: true, removedCount, removedBytes, mode: 'execute' };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[cleanup-migrated-storage] Error:', err.message);
      process.exit(1);
    });
}

module.exports = {
  discoverCleanupCandidates,
  run,
};
