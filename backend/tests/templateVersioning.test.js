// backend/tests/templateVersioning.test.js
process.env.NODE_ENV = 'test';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const templateService = require('../services/templateService');
const clientService = require('../services/clientService');

describe('Template Versioning & Retention Suite (Item #11)', () => {
  const testTenant = 'client-test-versioning';
  let validPptxBuffer = null;
  const masterTemplatePath = path.resolve(__dirname, '../../templates/master_template.pptx');

  before(async () => {
    validPptxBuffer = fs.readFileSync(masterTemplatePath);
    try {
      const { migrate } = require('../db/migrate');
      await migrate();
    } catch (_) {}
    try {
      const { execute } = require('../config/database');
      await execute('DELETE FROM templates WHERE tenant_id = ?', [testTenant]);
    } catch (_) {}
  });

  beforeEach(async () => {
    // Clean up test tenant directory before each test
    const tenantDir = path.resolve(__dirname, `../../data/tenants/${testTenant}`);
    if (fs.existsSync(tenantDir)) {
      await fs.promises.rm(tenantDir, { recursive: true, force: true }).catch(() => {});
    }
    try {
      const { execute } = require('../config/database');
      await execute('DELETE FROM templates WHERE tenant_id = ?', [testTenant]);
    } catch (_) {}
  });

  after(async () => {
    try {
      const { execute } = require('../config/database');
      await execute('DELETE FROM templates WHERE tenant_id = ?', [testTenant]);
    } catch (_) {}
    const tenantDir = path.resolve(__dirname, `../../data/tenants/${testTenant}`);
    if (fs.existsSync(tenantDir)) {
      await fs.promises.rm(tenantDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('1. Magic Byte Validation: Rejects spoofed or non-PPTX buffers', async () => {
    const fakeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00ThisIsAnExecutableNotAPptx');
    await assert.rejects(
      async () => {
        await templateService.createVersion(testTenant, fakeBuffer, 'malicious.pptx', 'admin@portal.com');
      },
      (err) => {
        assert.ok(err.message.includes('Invalid file signature') || err.message.includes('magic bytes'));
        return true;
      }
    );
  });

  it('2. Version Creation: Successfully creates v1 and initializes manifest', async () => {
    const version = await templateService.createVersion(
      testTenant,
      validPptxBuffer,
      'Corporate_Branding_v1.pptx',
      'admin@portal.com'
    );

    assert.ok(version.versionId, 'Version ID should be generated');
    assert.strictEqual(version.isActive, true, 'First uploaded version should automatically become active');
    assert.strictEqual(version.filename, 'Corporate_Branding_v1.pptx');
    assert.ok(version.sha256, 'SHA-256 hash must be generated');

    const manifest = await templateService.getManifest(testTenant);
    assert.strictEqual(manifest.activeVersionId, version.versionId);
    assert.strictEqual(manifest.versions.length, 1);
    assert.strictEqual(manifest.versions[0].versionId, version.versionId);

    // Verify file exists on disk
    const versionPath = path.resolve(__dirname, `../../data/tenants/${testTenant}/templates/versions/${version.storedName}`);
    assert.ok(fs.existsSync(versionPath), 'Versioned physical file must exist on disk');

    // Verify master.pptx copy exists for legacy compatibility
    const masterPath = path.resolve(__dirname, `../../data/tenants/${testTenant}/templates/master.pptx`);
    assert.ok(fs.existsSync(masterPath), 'master.pptx copy must exist for legacy compatibility');
  });

  it('3. Version Activation: Switching active version updates manifest and master.pptx', async () => {
    const v1 = await templateService.createVersion(testTenant, validPptxBuffer, 'Deck_v1.pptx', 'admin@portal.com');
    const v2 = await templateService.createVersion(testTenant, validPptxBuffer, 'Deck_v2.pptx', 'admin@portal.com');

    // v2 should be active by default upon creation
    let manifest = await templateService.getManifest(testTenant);
    assert.strictEqual(manifest.activeVersionId, v2.versionId);

    // Rollback / switch back to v1
    const activated = await templateService.activateVersion(testTenant, v1.versionId);
    assert.strictEqual(activated.activeVersionId, v1.versionId);

    manifest = await templateService.getManifest(testTenant);
    assert.strictEqual(manifest.activeVersionId, v1.versionId);
    const activeEntry = manifest.versions.find((v) => v.versionId === v1.versionId);
    assert.strictEqual(activeEntry.isActive, true);
    const inactiveEntry = manifest.versions.find((v) => v.versionId === v2.versionId);
    assert.strictEqual(inactiveEntry.isActive, false);
  });

  it('4. Global Fallback: When tenant has no templates or empty manifest, returns master_template.pptx', async () => {
    const emptyTenant = 'client-empty-template-tenant';
    const resolvedPath = templateService.getActiveTemplatePath(emptyTenant);

    assert.ok(resolvedPath, 'Path must be resolved');
    assert.strictEqual(path.resolve(resolvedPath), path.resolve(masterTemplatePath));
    assert.ok(fs.existsSync(resolvedPath), 'Fallback template must physically exist');

    // Also verify clientService integration fallback
    const clientServicePath = clientService.getTenantTemplatePath(emptyTenant);
    assert.strictEqual(path.resolve(clientServicePath), path.resolve(masterTemplatePath));
  });

  it('5. 5-Version Retention Policy: Uploading 6 versions automatically purges the oldest version', async () => {
    const versions = [];
    for (let i = 1; i <= 6; i++) {
      // Add slight delay so uploadedAt timestamps are distinct
      await new Promise((r) => setTimeout(r, 20));
      const v = await templateService.createVersion(
        testTenant,
        validPptxBuffer,
        `Template_Release_${i}.pptx`,
        'admin@portal.com'
      );
      versions.push(v);
    }

    const manifest = await templateService.getManifest(testTenant);
    assert.strictEqual(manifest.versions.length, 5, 'Manifest must strictly contain at most 5 versions');

    // The oldest version (v1) should have been pruned
    const oldest = versions[0];
    const existsInManifest = manifest.versions.some((v) => v.versionId === oldest.versionId);
    assert.strictEqual(existsInManifest, false, 'Oldest version must be removed from manifest');

    const oldestDiskPath = path.resolve(__dirname, `../../data/tenants/${testTenant}/templates/versions/${oldest.storedName}`);
    assert.strictEqual(fs.existsSync(oldestDiskPath), false, 'Oldest version file must be physically deleted from disk');

    // Versions 2 through 6 must still exist
    for (let i = 1; i < versions.length; i++) {
      const vPath = path.resolve(__dirname, `../../data/tenants/${testTenant}/templates/versions/${versions[i].storedName}`);
      assert.ok(fs.existsSync(vPath), `Version ${versions[i].versionId} should exist on disk`);
    }
  });

  it('6. Delete Inactive Version: Successfully deletes file, but rejects deleting active version', async () => {
    const v1 = await templateService.createVersion(testTenant, validPptxBuffer, 'Deck_v1.pptx', 'admin@portal.com');
    const v2 = await templateService.createVersion(testTenant, validPptxBuffer, 'Deck_v2.pptx', 'admin@portal.com');

    // Attempt to delete active version (v2) -> must throw error
    await assert.rejects(
      async () => {
        await templateService.deleteVersion(testTenant, v2.versionId);
      },
      (err) => {
        assert.ok(err.message.includes('Cannot delete active template version'));
        return true;
      }
    );

    // Delete inactive version (v1) -> must succeed
    const res = await templateService.deleteVersion(testTenant, v1.versionId);
    assert.strictEqual(res.success, true);

    const manifest = await templateService.getManifest(testTenant);
    assert.strictEqual(manifest.versions.length, 1);
    assert.strictEqual(manifest.versions[0].versionId, v2.versionId);

    const v1Path = path.resolve(__dirname, `../../data/tenants/${testTenant}/templates/versions/${v1.storedName}`);
    assert.strictEqual(fs.existsSync(v1Path), false, 'Physical file must be deleted');
  });

  it('7. Multi-Tenant Isolation: Tenant A cannot view or activate Tenant B templates', async () => {
    const tenantA = 'client-tenant-a';
    const tenantB = 'client-tenant-b';

    const vA = await templateService.createVersion(tenantA, validPptxBuffer, 'A_Deck.pptx', 'admin@portal.com');
    const vB1 = await templateService.createVersion(tenantB, validPptxBuffer, 'B_Deck1.pptx', 'admin@portal.com');
    const vB2 = await templateService.createVersion(tenantB, validPptxBuffer, 'B_Deck2.pptx', 'admin@portal.com');

    const manifestA = await templateService.getManifest(tenantA);
    const manifestB = await templateService.getManifest(tenantB);

    assert.strictEqual(manifestA.versions.some((v) => v.filename === 'B_Deck1.pptx'), false);
    assert.strictEqual(manifestB.versions.some((v) => v.filename === 'A_Deck.pptx'), false);
    assert.strictEqual(manifestA.versions.some((v) => v.storedName === vB1.storedName), false);

    // Tenant A only has v1. Attempting to activate v2 (which only exists in Tenant B) -> must throw
    await assert.rejects(
      async () => {
        await templateService.activateVersion(tenantA, vB2.versionId);
      },
      (err) => {
        assert.ok(err.message.includes('Version not found'));
        return true;
      }
    );

    // Clean up
    await fs.promises.rm(path.resolve(__dirname, `../../data/tenants/${tenantA}`), { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(path.resolve(__dirname, `../../data/tenants/${tenantB}`), { recursive: true, force: true }).catch(() => {});
  });
});
