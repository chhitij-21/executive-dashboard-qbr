// backend/tests/storageRepo.test.js
// Unit & Integration Test Suite for Storage Repository (Item #2.1)
'use strict';

require('./_setup');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { setupTestEnvironment } = require('./_setup');

describe('Storage Repository Suite (Item #2.1: Turso DB BLOB Storage)', () => {
  let storageRepo;

  before(async () => {
    await setupTestEnvironment();
    storageRepo = require('../repositories/storageRepo');
  });

  it('1. storageRepo_put_get_small_file_roundtrip: stores and retrieves small file with SHA-256 etag', async () => {
    const tenantId = 'client-jfl';
    const key = `tenants/${tenantId}/reports/job-101/deck.pptx`;
    const payload = Buffer.from('PK\x03\x04test_presentation_buffer_content_' + Date.now(), 'utf8');
    const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

    const putRes = await storageRepo.putObject({
      tenantId,
      key,
      buffer: payload,
      mimeType,
    });

    assert.ok(putRes.id, 'Expected object id');
    assert.strictEqual(putRes.sizeBytes, payload.length);
    assert.strictEqual(putRes.etag, crypto.createHash('sha256').update(payload).digest('hex'));

    const getRes = await storageRepo.getObject({ tenantId, key });
    assert.ok(getRes, 'Expected object to be found');
    assert.strictEqual(getRes.metadata.key, key);
    assert.strictEqual(getRes.metadata.mimeType, mimeType);
    assert.strictEqual(getRes.metadata.sizeBytes, payload.length);
    assert.deepStrictEqual(getRes.buffer, payload);
  });

  it('2. storageRepo_put_get_large_chunked_file_roundtrip: slices file >4MB into chunks and reassembles perfectly', async () => {
    const tenantId = 'client-jfl';
    const key = `tenants/${tenantId}/reports/job-102/large_deck.pptx`;
    // Create 6 MB buffer (should result in 2 chunks: 4 MB + 2 MB)
    const chunkSize = 4 * 1024 * 1024;
    const totalSize = 6 * 1024 * 1024;
    const largeBuffer = Buffer.alloc(totalSize);
    for (let i = 0; i < totalSize; i += 1024) {
      largeBuffer.writeUInt32LE(i, i);
    }
    const expectedHash = crypto.createHash('sha256').update(largeBuffer).digest('hex');

    const putRes = await storageRepo.putObject({
      tenantId,
      key,
      buffer: largeBuffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });

    assert.strictEqual(putRes.sizeBytes, totalSize);
    assert.strictEqual(putRes.etag, expectedHash);

    // Verify chunks directly in storage_chunks
    const { execute } = require('../config/database');
    const chunksQuery = await execute('SELECT chunk_index, size_bytes FROM storage_chunks WHERE object_id = ? ORDER BY chunk_index ASC', [putRes.id]);
    assert.strictEqual(chunksQuery.rows.length, 2, 'Expected exactly 2 chunks for 6MB payload');
    assert.strictEqual(Number(chunksQuery.rows[0].size_bytes), chunkSize);
    assert.strictEqual(Number(chunksQuery.rows[1].size_bytes), totalSize - chunkSize);

    // Reassemble and verify integrity
    const getRes = await storageRepo.getObject({ tenantId, key });
    assert.strictEqual(getRes.buffer.length, totalSize);
    const retrievedHash = crypto.createHash('sha256').update(getRes.buffer).digest('hex');
    assert.strictEqual(retrievedHash, expectedHash);
  });

  it('3. storageRepo_deleteObject_cascades_chunks: deleting object cascades to all chunks', async () => {
    const tenantId = 'client-mmtcpamp';
    const key = `tenants/${tenantId}/templates/v1.pptx`;
    const buffer = Buffer.from('template_data_v1_' + Date.now(), 'utf8');

    const putRes = await storageRepo.putObject({
      tenantId,
      key,
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });

    const { execute } = require('../config/database');
    const beforeChunks = await execute('SELECT COUNT(*) as cnt FROM storage_chunks WHERE object_id = ?', [putRes.id]);
    assert.ok(Number(beforeChunks.rows[0].cnt) >= 1);

    const deleted = await storageRepo.deleteObject({ tenantId, key });
    assert.strictEqual(deleted, true);

    const afterObj = await storageRepo.getObject({ tenantId, key });
    assert.strictEqual(afterObj, null);

    const afterChunks = await execute('SELECT COUNT(*) as cnt FROM storage_chunks WHERE object_id = ?', [putRes.id]);
    assert.strictEqual(Number(afterChunks.rows[0].cnt), 0, 'Expected child chunks to be deleted');
  });

  it('4. storageRepo_listObjects_filters_by_tenant_and_prefix', async () => {
    const tenantA = 'client-tenant-a';
    const tenantB = 'client-tenant-b';

    await storageRepo.putObject({ tenantId: tenantA, key: `tenants/${tenantA}/reports/r1.pptx`, buffer: Buffer.from('a1'), mimeType: 'text/plain' });
    await storageRepo.putObject({ tenantId: tenantA, key: `tenants/${tenantA}/reports/r2.pptx`, buffer: Buffer.from('a2'), mimeType: 'text/plain' });
    await storageRepo.putObject({ tenantId: tenantA, key: `tenants/${tenantA}/templates/t1.pptx`, buffer: Buffer.from('t1'), mimeType: 'text/plain' });
    await storageRepo.putObject({ tenantId: tenantB, key: `tenants/${tenantB}/reports/rB.pptx`, buffer: Buffer.from('b1'), mimeType: 'text/plain' });

    const reportsA = await storageRepo.listObjects({ tenantId: tenantA, prefix: `tenants/${tenantA}/reports/` });
    assert.strictEqual(reportsA.length, 2);
    assert.ok(reportsA.every(o => o.key.includes('/reports/')));

    const templatesA = await storageRepo.listObjects({ tenantId: tenantA, prefix: `tenants/${tenantA}/templates/` });
    assert.strictEqual(templatesA.length, 1);
  });

  it('5. storageRepo_tenant_isolation_rejects_cross_tenant_access', async () => {
    const ownerTenant = 'client-jfl';
    const unauthorizedTenant = 'client-mmtcpamp';
    const key = `tenants/${ownerTenant}/reports/sensitive-qbr.pptx`;

    await storageRepo.putObject({
      tenantId: ownerTenant,
      key,
      buffer: Buffer.from('secret_executive_sla_data'),
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });

    // Attempting to access owner's key with unauthorized tenant ID must return null (or throw)
    const unauthorizedAccess = await storageRepo.getObject({ tenantId: unauthorizedTenant, key });
    assert.strictEqual(unauthorizedAccess, null);
  });

  it('6. storageRepo_streamObject_returns_304_on_etag_match', async () => {
    const tenantId = 'client-jfl';
    const key = `tenants/${tenantId}/reports/cache-test.pptx`;
    const buffer = Buffer.from('cache_content_' + Date.now());

    const putRes = await storageRepo.putObject({ tenantId, key, buffer, mimeType: 'text/plain' });

    let statusSent = 200;
    let headersSet = {};
    let ended = false;
    let writtenData = [];

    const mockRes = {
      status(s) { statusSent = s; return this; },
      setHeader(k, v) { headersSet[k.toLowerCase()] = v; },
      write(chunk) { writtenData.push(chunk); },
      end() { ended = true; },
    };

    const mockReqMatchingEtag = {
      headers: { 'if-none-match': putRes.etag },
    };

    await storageRepo.streamObjectToResponse({
      tenantId,
      key,
      req: mockReqMatchingEtag,
      res: mockRes,
      filename: 'report.pptx',
    });

    assert.strictEqual(statusSent, 304, 'Expected HTTP 304 on matching etag');
    assert.strictEqual(ended, true);
    assert.strictEqual(writtenData.length, 0, 'Expected zero bytes written on 304');
  });

  it('7. storageRepo_pruneExpiredObjects_removes_old_reports_preserves_templates', async () => {
    const tenantId = 'client-jfl';
    const oldReportKey = `tenants/${tenantId}/reports/old-run/deck.pptx`;
    const templateKey = `tenants/${tenantId}/templates/active.pptx`;

    const rRes = await storageRepo.putObject({ tenantId, key: oldReportKey, buffer: Buffer.from('old_report'), mimeType: 'text/plain' });
    const tRes = await storageRepo.putObject({ tenantId, key: templateKey, buffer: Buffer.from('active_template'), mimeType: 'text/plain' });

    const { execute } = require('../config/database');
    // Artificially age the report to 400 days ago
    await execute("UPDATE storage_objects SET created_at = datetime('now', '-400 days') WHERE id = ?", [rRes.id]);
    await execute("UPDATE storage_objects SET created_at = datetime('now', '-400 days') WHERE id = ?", [tRes.id]);

    const prunedCount = await storageRepo.pruneExpiredObjects({ olderThanDays: 365 });
    assert.ok(prunedCount >= 1);

    const reportAfter = await storageRepo.getObject({ tenantId, key: oldReportKey });
    assert.strictEqual(reportAfter, null, 'Expected old report to be pruned');

    const templateAfter = await storageRepo.getObject({ tenantId, key: templateKey });
    assert.ok(templateAfter, 'Expected template to be preserved despite being older than 365 days');
  });
});
