// backend/tests/templateRoutes.test.js
process.env.NODE_ENV = 'test';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const app = require('../index');

describe('Template Routes & Admin RBAC Suite (Item #11)', () => {
  const tenantId = 'client-jfl';
  let server = null;
  let baseUrl = '';
  let adminToken = '';
  let clientToken = '';
  let validPptxBuffer = null;

  before(async () => {
    validPptxBuffer = fs.readFileSync(path.resolve(__dirname, '../../templates/master_template.pptx'));

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Login Admin
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@portal.com', password: 'admin123' }),
    });
    const adminData = await adminLoginRes.json();
    adminToken = adminData.token;

    // Login Client User (JFL)
    const clientLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jfl@portal.com', password: 'jfl123' }),
    });
    const clientData = await clientLoginRes.json();
    clientToken = clientData.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const templatesDir = path.resolve(__dirname, `../../data/tenants/${tenantId}/templates`);
    if (fs.existsSync(templatesDir)) {
      try {
        fs.rmSync(templatesDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  it('1. GET /api/tenants/:id/templates allows client user to list templates', async () => {
    const res = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates`, {
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'x-client-id': tenantId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.versions));
  });

  it('2. POST /api/tenants/:id/templates blocks client user with 403 Forbidden', async () => {
    const formData = new FormData();
    const blob = new Blob([validPptxBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    formData.append('template', blob, 'test_deck.pptx');

    const res = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'x-client-id': tenantId,
      },
      body: formData,
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes('Admin access required') || body.error.includes('Forbidden') || body.code === 'ADMIN_ACCESS_REQUIRED');
  });

  it('3. POST /api/tenants/:id/templates/:versionId/activate blocks client user with 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates/v1/activate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'x-client-id': tenantId,
      },
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes('Admin access required') || body.error.includes('Forbidden') || body.code === 'ADMIN_ACCESS_REQUIRED');
  });

  it('4. POST /api/tenants/:id/templates allows Admin to upload valid template version', async () => {
    const formData = new FormData();
    const blob = new Blob([validPptxBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    formData.append('template', blob, 'Admin_Uploaded_Deck.pptx');

    const res = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-client-id': tenantId,
      },
      body: formData,
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.version.versionId);
    assert.strictEqual(body.version.filename, 'Admin_Uploaded_Deck.pptx');
  });

  it('5. POST /api/tenants/:id/templates rejects spoofed non-PPTX file with 400', async () => {
    const fakeBuffer = Buffer.from('NOT_A_VALID_ZIP_OR_PPTX_FILE_HEADER');
    const formData = new FormData();
    const blob = new Blob([fakeBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    formData.append('template', blob, 'malicious.pptx');

    const res = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-client-id': tenantId,
      },
      body: formData,
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Invalid file signature') || body.code === 'UPLOAD_FAILED');
  });

  it('6. POST /api/tenants/:id/templates/:versionId/activate allows Admin to activate version', async () => {
    // List templates to find active and inactive version
    const listRes = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listBody = await listRes.json();
    const versions = listBody.versions;
    assert.ok(versions.length > 0);
    const targetVersion = versions[0];

    const activateRes = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates/${targetVersion.versionId}/activate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-client-id': tenantId,
      },
    });

    assert.strictEqual(activateRes.status, 200);
    const activateBody = await activateRes.json();
    assert.strictEqual(activateBody.success, true);
    assert.strictEqual(activateBody.activeVersionId, targetVersion.versionId);
  });

  it('7. GET /api/tenants/:id/templates/:versionId/download downloads template version', async () => {
    const listRes = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listBody = await listRes.json();
    const versionId = listBody.activeVersionId;

    const downloadRes = await fetch(`${baseUrl}/api/tenants/${tenantId}/templates/${versionId}/download`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.strictEqual(downloadRes.status, 200);
    const downloadedBuf = Buffer.from(await downloadRes.arrayBuffer());
    assert.ok(downloadedBuf.length > 0);
    assert.strictEqual(downloadedBuf[0], 0x50); // P
    assert.strictEqual(downloadedBuf[1], 0x4B); // K
  });

  it('8. Client user cannot view another tenant templates (cross-tenant 403)', async () => {
    // clientToken belongs to JFL (client-jfl), try to query client-mmtc
    const res = await fetch(`${baseUrl}/api/tenants/client-mmtc/templates`, {
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'x-client-id': 'client-mmtc',
      },
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'TENANT_FORBIDDEN');
  });
});
