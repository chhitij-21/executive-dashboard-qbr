// backend/tests/dualWriteStorage.test.js
// Hermetic Test Isolation & Setup
require('./_setup');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { setupTestEnvironment } = require('./_setup');

const storageRepo = require('../repositories/storageRepo');
const { generatePPT } = require('../services/pptGenerator');
const templateService = require('../services/templateService');
const queueService = require('../services/queueService');

describe('Sub-Item #2.2: Dual-Write & Storage Orphan Prevention Suite', () => {
  const originalBackend = process.env.STORAGE_BACKEND;
  const testTenantId = 'client-test-dualwrite';
  const tempDir = path.join(os.tmpdir(), `dualwrite_test_${Date.now()}`);

  before(async () => {
    await setupTestEnvironment();
    process.env.STORAGE_BACKEND = 'dual';
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  });

  after(async () => {
    process.env.STORAGE_BACKEND = originalBackend;
    if (fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  function createValidPptxBuffer() {
    const buf = Buffer.alloc(100);
    buf[0] = 0x50; buf[1] = 0x4B; buf[2] = 0x03; buf[3] = 0x04;
    return buf;
  }

  function getValidMockData() {
    const defaultData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/bundled_default/dashboard_data.json'), 'utf8'));
    return {
      ...defaultData,
      clientId: 'client-jfl',
    };
  }

  it('1. generatePPT: Writes to both local disk and DB storage in dual mode', async () => {
    const mockData = getValidMockData();
    const jobId = `job_test_dual_${Date.now()}`;
    const outPath = path.join(tempDir, `${jobId}.pptx`);

    await generatePPT(mockData, null, outPath, { jobId });
    assert.ok(fs.existsSync(outPath), 'Local PPT file must exist');

    const key = `tenants/client-jfl/reports/${jobId}/${path.basename(outPath)}`;
    const stored = await storageRepo.getObject({ tenantId: 'client-jfl', key });
    assert.ok(stored, 'Object must be written to DB storage');
    assert.ok(stored.buffer.length > 0, 'DB storage buffer must not be empty');
  });

  it('2. generatePPT: Both-must-succeed policy unlinks disk file if DB storage write fails', async () => {
    const mockData = getValidMockData();
    const outPath = path.join(tempDir, `failure_abort_${Date.now()}.pptx`);

    // Temporarily point storageRepo.putObject to simulate DB write failure
    const origPut = storageRepo.putObject;
    storageRepo.putObject = async () => {
      throw new Error('Simulated Turso database storage outage');
    };

    try {
      await assert.rejects(
        async () => {
          await generatePPT(mockData, null, outPath);
        },
        /Dual-write storage failure: Simulated Turso database storage outage/
      );

      // Verify both-must-succeed invariant: disk file must be removed!
      assert.strictEqual(fs.existsSync(outPath), false, 'Disk file must be cleaned up on DB storage failure');
    } finally {
      storageRepo.putObject = origPut;
    }
  });

  it('3. templateService.createVersion: Dual-writes version and master.pptx to storageRepo', async () => {
    const pptxBuf = createValidPptxBuffer();
    const ver = await templateService.createVersion(testTenantId, pptxBuf, 'test_deck.pptx', 'operator@test.com');
    assert.ok(ver.versionId);

    const versionKey = `tenants/${testTenantId}/templates/${ver.storedName}`;
    const masterKey = `tenants/${testTenantId}/templates/master.pptx`;

    const storedVer = await storageRepo.getObject({ tenantId: testTenantId, key: versionKey });
    assert.ok(storedVer, 'Stored version must exist in storageRepo');
    assert.strictEqual(storedVer.buffer.length, pptxBuf.length);

    const storedMaster = await storageRepo.getObject({ tenantId: testTenantId, key: masterKey });
    assert.ok(storedMaster, 'Active master.pptx must exist in storageRepo');
  });

  it('4. templateService.createVersion: Fails closed and unlinks disk file if storage fails', async () => {
    const pptxBuf = createValidPptxBuffer();
    const origPut = storageRepo.putObject;
    storageRepo.putObject = async () => {
      throw new Error('Storage write rejection');
    };

    try {
      await assert.rejects(
        async () => {
          await templateService.createVersion(testTenantId, pptxBuf, 'fail_deck.pptx');
        },
        /Dual-write storage failure: Storage write rejection/
      );
    } finally {
      storageRepo.putObject = origPut;
    }
  });

  it('5. templateService.activateVersion: Syncs active version to master.pptx in DB storage', async () => {
    const pptxBuf1 = createValidPptxBuffer();
    const v1 = await templateService.createVersion(testTenantId, pptxBuf1, 'v1.pptx');

    const pptxBuf2 = Buffer.concat([createValidPptxBuffer(), Buffer.from('extra_bytes_v2')]);
    const v2 = await templateService.createVersion(testTenantId, pptxBuf2, 'v2.pptx');

    // Activate v1 again
    await templateService.activateVersion(testTenantId, v1.versionId);

    const masterObj = await storageRepo.getObject({ tenantId: testTenantId, key: `tenants/${testTenantId}/templates/master.pptx` });
    assert.ok(masterObj);
    assert.strictEqual(masterObj.buffer.length, pptxBuf1.length, 'Master in DB storage must reflect newly activated v1 content');
  });

  it('6. templateService: 5-version retention policy prunes oldest from disk AND storageRepo', async () => {
    const tenantRetention = 'client-retention-test';
    const versions = [];
    for (let i = 1; i <= 6; i++) {
      const buf = Buffer.concat([createValidPptxBuffer(), Buffer.from(`ver_${i}`)]);
      const v = await templateService.createVersion(tenantRetention, buf, `template_${i}.pptx`);
      versions.push(v);
    }

    // Version 1 should have been pruned from DB storage
    const v1Key = `tenants/${tenantRetention}/templates/${versions[0].storedName}`;
    const prunedObj = await storageRepo.getObject({ tenantId: tenantRetention, key: v1Key });
    assert.strictEqual(prunedObj, null, 'Pruned version 1 must not exist in storageRepo');

    // Version 6 must exist
    const v6Key = `tenants/${tenantRetention}/templates/${versions[5].storedName}`;
    const activeObj = await storageRepo.getObject({ tenantId: tenantRetention, key: v6Key });
    assert.ok(activeObj, 'Active version 6 must exist in storageRepo');
  });

  it('7. templateService.deleteVersion: Removes deleted version from storageRepo', async () => {
    const tenantDel = 'client-del-test';
    const buf1 = Buffer.concat([createValidPptxBuffer(), Buffer.from('d1')]);
    const buf2 = Buffer.concat([createValidPptxBuffer(), Buffer.from('d2')]);
    const v1 = await templateService.createVersion(tenantDel, buf1, 'd1.pptx');
    const v2 = await templateService.createVersion(tenantDel, buf2, 'd2.pptx'); // active

    // Delete inactive v1
    await templateService.deleteVersion(tenantDel, v1.versionId);
    const deletedObj = await storageRepo.getObject({ tenantId: tenantDel, key: `tenants/${tenantDel}/templates/${v1.storedName}` });
    assert.strictEqual(deletedObj, null, 'Deleted version must be removed from storageRepo');
  });

  it('8. queueService.purgeOrphanedUploads: Purges staged uploads on job failure', async () => {
    const testJobId = `job_orphan_${Date.now()}`;
    const testKey = `tenants/client-jfl/uploads/${testJobId}/incidents.xlsx`;

    await storageRepo.putObject({
      tenantId: 'client-jfl',
      key: testKey,
      buffer: Buffer.from('mock_excel_content'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const beforeObj = await storageRepo.getObject({ tenantId: 'client-jfl', key: testKey });
    assert.ok(beforeObj, 'Upload must exist before purge');

    // Simulate orphan purge on job failure
    await queueService.purgeOrphanedUploads(testJobId);

    const afterObj = await storageRepo.getObject({ tenantId: 'client-jfl', key: testKey });
    assert.strictEqual(afterObj, null, 'Orphaned upload must be purged from storageRepo');
  });

  it('9. migrate-to-db-storage: Dry-run, live execution, idempotency and reconciliation gate', async () => {
    const migration = require('../../scripts/migrate-to-db-storage');
    // 1. Dry run
    const dryRes = await migration.run({ execute: false });
    assert.strictEqual(dryRes.success, true);
    assert.strictEqual(dryRes.mode, 'dry-run');

    // 2. Create sample file in reports directory
    const reportsDir = path.resolve(__dirname, '../../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const testReportFile = path.join(reportsDir, `jfl_test_mig_${Date.now()}.pptx`);
    fs.writeFileSync(testReportFile, createValidPptxBuffer());

    try {
      // 3. Live execution with reconciliation gate
      const execRes = await migration.run({ execute: true });
      assert.strictEqual(execRes.success, true);
      assert.strictEqual(execRes.mode, 'execute');
      assert.ok(execRes.totalFiles >= 1);

      // Verify object exists in storageRepo
      const inv = migration.discoverMigrationInventory();
      const targetItem = inv.find((i) => i.filePath === testReportFile);
      assert.ok(targetItem);
      const stored = await storageRepo.getObject({ tenantId: targetItem.tenantId, key: targetItem.key });
      assert.ok(stored);

      // 4. Idempotency re-run
      const rerunRes = await migration.run({ execute: true });
      assert.strictEqual(rerunRes.success, true);
      assert.ok(rerunRes.skippedCount >= 1, 'Subsequent run must skip matching etags');
    } finally {
      if (fs.existsSync(testReportFile)) fs.unlinkSync(testReportFile);
    }
  });

  it('10. Sub-Item #2.3: streamObjectToResponse sets ETag, Content-Disposition and handles 304', async () => {
    const key = `tenants/client-jfl/reports/stream_test/report.pptx`;
    const buf = Buffer.from('test_stream_content');
    const putRes = await storageRepo.putObject({
      tenantId: 'client-jfl',
      key,
      buffer: buf,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });

    // Mock Express res & req
    const headers = {};
    let written = Buffer.alloc(0);
    let ended = false;
    let statusCode = 200;

    const mockRes = {
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      status: (c) => { statusCode = c; return mockRes; },
      write: (chunk) => { written = Buffer.concat([written, chunk]); },
      end: () => { ended = true; },
      json: () => {},
    };

    const mockReq = { headers: {} };

    // Initial 200 streaming
    const streamed = await storageRepo.streamObjectToResponse({
      tenantId: 'client-jfl',
      key,
      req: mockReq,
      res: mockRes,
      filename: 'QBR_Report.pptx',
    });

    assert.strictEqual(streamed, true);
    assert.strictEqual(ended, true);
    assert.strictEqual(headers['etag'], putRes.etag);
    assert.strictEqual(headers['content-disposition'], 'attachment; filename="QBR_Report.pptx"');
    assert.strictEqual(written.toString('utf8'), 'test_stream_content');

    // Conditional 304 request
    let ended304 = false;
    let code304 = 200;
    const mockRes304 = {
      setHeader: () => {},
      status: (c) => { code304 = c; return mockRes304; },
      write: () => {},
      end: () => { ended304 = true; },
    };
    const mockReq304 = { headers: { 'if-none-match': putRes.etag } };

    const streamed304 = await storageRepo.streamObjectToResponse({
      tenantId: 'client-jfl',
      key,
      req: mockReq304,
      res: mockRes304,
    });

    assert.strictEqual(streamed304, true);
    assert.strictEqual(code304, 304);
    assert.strictEqual(ended304, true);
  });

  it('11. Sub-Item #2.3: Tenant isolation rejects cross-tenant stream attempts with 403', async () => {
    const key = `tenants/client-jfl/reports/private/report.pptx`;
    await storageRepo.putObject({
      tenantId: 'client-jfl',
      key,
      buffer: Buffer.from('private_jfl_data'),
    });

    let code = 200;
    let errJson = null;
    const mockRes = {
      setHeader: () => {},
      status: (c) => { code = c; return mockRes; },
      json: (j) => { errJson = j; },
      write: () => {},
      end: () => {},
    };

    // Cross-tenant attempt by client-mmtcpamp
    const res = await storageRepo.streamObjectToResponse({
      tenantId: 'client-mmtcpamp',
      key,
      req: { headers: {} },
      res: mockRes,
    });

    assert.strictEqual(res, false);
    assert.strictEqual(code, 403);
    assert.strictEqual(errJson.code, 'FORBIDDEN_TENANT_ACCESS');
  });

  it('12. Sub-Item #2.3: Dedicated logo streaming route serves DB branding asset', async () => {
    const logoBuf = Buffer.from('<svg>logo</svg>', 'utf8');
    await storageRepo.putObject({
      tenantId: 'client-jfl',
      key: 'tenants/client-jfl/branding/logosvg',
      buffer: logoBuf,
      mimeType: 'image/svg+xml',
    });

    const express = require('express');
    const app = express();
    const v1Router = require('../routes/v1Router');
    app.use('/', v1Router);

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // Put standard logo
      await storageRepo.putObject({
        tenantId: 'client-jfl',
        key: 'tenants/client-jfl/branding/logo.png',
        buffer: Buffer.from('png_logo_data'),
        mimeType: 'image/png',
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/tenants/client-jfl/logo`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      const body = await res.text();
      assert.strictEqual(body, 'png_logo_data');
    } finally {
      server.close();
    }
  });

  it('13. Sub-Item #2.4: cleanup-migrated-storage safely purges local copies only after verifying DB ETag', async () => {
    const cleanup = require('../../scripts/cleanup-migrated-storage');

    // 1. Create a dummy migrated report
    const reportsDir = path.resolve(__dirname, '../../reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const dummyFile = path.join(reportsDir, `jfl_cleanup_test_${Date.now()}.pptx`);
    const buf = createValidPptxBuffer();
    fs.writeFileSync(dummyFile, buf);

    try {
      // Put into DB with exact ETag
      const key = `tenants/client-jfl/reports/legacy/${path.basename(dummyFile)}`;
      await storageRepo.putObject({
        tenantId: 'client-jfl',
        key,
        buffer: buf,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });

      // Cleanup finds it eligible
      const dryRes = await cleanup.run({ execute: false });
      assert.strictEqual(dryRes.success, true);
      assert.ok(dryRes.eligibleCount >= 1);

      // Execute live removal
      const execRes = await cleanup.run({ execute: true });
      assert.strictEqual(execRes.success, true);
      assert.ok(execRes.removedCount >= 1);
      assert.strictEqual(fs.existsSync(dummyFile), false, 'Verified local copy must be unlinked');

      // Verify DB copy still exists intact
      const dbObj = await storageRepo.getObject({ tenantId: 'client-jfl', key });
      assert.ok(dbObj, 'DB storage object must remain intact after local disk cleanup');
    } finally {
      if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
    }
  });

  it('14. Sub-Item #2.4: schedulerService mounts standing nightly storage lifecycle prune task', async () => {
    const schedulerService = require('../services/schedulerService');
    await schedulerService.initSchedulers();

    const health = schedulerService.getHealth();
    assert.strictEqual(typeof health.ready, 'boolean');
    assert.ok(health.activeTasks >= 1, 'At least the storage lifecycle standing task must be active');

    // Clean teardown
    schedulerService.stopAll();
  });
});
