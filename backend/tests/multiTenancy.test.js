require('./_setup');
// backend/tests/multiTenancy.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const clientService = require('../services/clientService');
const ruleEngine = require('../services/ruleEngine');
const { resolveTenantContext } = require('../middleware/tenantContext');

describe('Multi-Tenancy & Whitelabel Isolation Suite (Item #8)', () => {
  const TEST_TENANT_ID = 'client-test-tenancy';
  const tenantDir = clientService.getTenantDir(TEST_TENANT_ID);

  after(() => {
    // Cleanup test tenant directory
    if (fs.existsSync(tenantDir)) {
      fs.rmSync(tenantDir, { recursive: true, force: true });
    }
  });

  it('1. ensureTenantDirs initializes partitioned filesystem namespace', () => {
    const dirs = clientService.ensureTenantDirs(TEST_TENANT_ID);
    assert.ok(fs.existsSync(dirs.rootDir), 'Root tenant dir must exist');
    assert.ok(fs.existsSync(dirs.reportsDir), 'Reports dir must exist');
    assert.ok(fs.existsSync(dirs.templatesDir), 'Templates dir must exist');
    assert.ok(fs.existsSync(dirs.settingsFile), 'Settings file must exist');

    const settings = clientService.getTenantSettings(TEST_TENANT_ID);
    assert.ok(settings, 'Tenant settings must be loadable');
    assert.strictEqual(typeof settings.slaTarget, 'number', 'Default slaTarget must be a number');
    assert.ok(settings.branding, 'Branding object must exist');
  });

  it('2. updateTenantSettings validates and persists branding hex colors and logo', () => {
    clientService.ensureTenantDirs(TEST_TENANT_ID);

    // Valid update
    const updated = clientService.updateTenantSettings(TEST_TENANT_ID, {
      slaTarget: 99.5,
      branding: {
        logo: 'https://example.com/logo.png',
        primaryColor: '#1e3a8a',
        secondaryColor: '#3b82f6',
        accentColor: '#10b981',
      },
    });

    assert.strictEqual(updated.slaTarget, 99.5);
    assert.strictEqual(updated.branding.primaryColor, '#1e3a8a');
    assert.strictEqual(updated.branding.secondaryColor, '#3b82f6');
    assert.strictEqual(updated.branding.accentColor, '#10b981');
    assert.strictEqual(updated.branding.logo, 'https://example.com/logo.png');

    // Invalid hex color should throw or reject
    assert.throws(
      () => {
        clientService.updateTenantSettings(TEST_TENANT_ID, {
          branding: { primaryColor: 'invalid-hex' },
        });
      },
      /INVALID_HEX_COLOR|Invalid hex/i
    );
  });

  it('3. getTenantTemplatePath routes to tenant template with global fallback', () => {
    clientService.ensureTenantDirs(TEST_TENANT_ID);

    // Initial state: no custom template -> must return global fallback
    const fallbackPath = clientService.getTenantTemplatePath(TEST_TENANT_ID);
    assert.ok(fs.existsSync(fallbackPath), 'Global fallback template must exist');
    assert.match(fallbackPath, /master_template\.pptx/);

    // Create a mock tenant-specific template
    const tenantTemplate = path.join(tenantDir, 'templates', 'master.pptx');
    fs.writeFileSync(tenantTemplate, 'MOCK_PPTX_DATA');

    const customPath = clientService.getTenantTemplatePath(TEST_TENANT_ID);
    assert.strictEqual(customPath, tenantTemplate, 'Must route to tenant-specific master.pptx');
  });

  it('4. resolveTenantContext middleware verifies tenant claims and isolates context', () => {
    clientService.ensureTenantDirs(TEST_TENANT_ID);

    // 4a: Admin can access any tenant
    const adminReq = {
      user: { role: 'admin', assignedClient: '*' },
      query: { clientId: TEST_TENANT_ID },
      headers: {},
    };
    const adminRes = {};
    let nextCalled = false;
    resolveTenantContext(adminReq, adminRes, (err) => {
      if (!err) nextCalled = true;
    });

    assert.ok(nextCalled, 'Admin request should pass tenant resolution');
    assert.ok(adminReq.tenant, 'req.tenant must be attached');
    assert.strictEqual(adminReq.tenant.id, TEST_TENANT_ID);
    assert.ok(adminReq.tenant.reportsDir);
    assert.ok(adminReq.tenant.branding);

    // 4b: Non-admin for another tenant must be rejected
    const intruderReq = {
      user: { role: 'client', assignedClient: 'client-other' },
      query: { clientId: TEST_TENANT_ID },
      headers: {},
    };
    const intruderRes = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };

    resolveTenantContext(intruderReq, intruderRes, () => {});
    assert.strictEqual(intruderRes.statusCode, 403, 'Intruder request must return 403');
    assert.strictEqual(intruderRes.body?.code, 'CUSTOMER_ISOLATION_VIOLATION');
  });

  it('5. loadTenantRules loads tenant custom rules with global fallback', () => {
    clientService.ensureTenantDirs(TEST_TENANT_ID);

    // Fallback when no tenant rules.yaml
    const defaultRules = ruleEngine.loadTenantRules(TEST_TENANT_ID);
    assert.ok(defaultRules, 'Rules must load');
    assert.ok(defaultRules.sla || defaultRules.health_score, 'Default rules must be populated');

    // When tenant rules.yaml is created
    const tenantRulesPath = path.join(tenantDir, 'rules.yaml');
    fs.writeFileSync(tenantRulesPath, 'tenant_custom_name: TestRules\nsla_target: 99.8\n');

    const customRules = ruleEngine.loadTenantRules(TEST_TENANT_ID);
    assert.strictEqual(customRules.tenant_custom_name, 'TestRules');
    assert.strictEqual(customRules.sla_target, 99.8);
  });

  it('6. updateTenantSettings merges partial branding updates safely', () => {
    clientService.ensureTenantDirs(TEST_TENANT_ID);
    clientService.updateTenantSettings(TEST_TENANT_ID, {
      branding: { primaryColor: '#002244', secondaryColor: '#4488cc' },
    });

    // Update only accentColor
    const merged = clientService.updateTenantSettings(TEST_TENANT_ID, {
      branding: { accentColor: '#ff5500' },
    });

    assert.strictEqual(merged.branding.primaryColor, '#002244', 'Primary color must be retained');
    assert.strictEqual(merged.branding.secondaryColor, '#4488cc', 'Secondary color must be retained');
    assert.strictEqual(merged.branding.accentColor, '#ff5500', 'Accent color must be updated');
  });

  it('7. Whitelabel PPT template routing handles removal and fallback dynamically', () => {
    clientService.ensureTenantDirs(TEST_TENANT_ID);
    const tenantTpl = path.join(tenantDir, 'templates', 'master.pptx');
    fs.writeFileSync(tenantTpl, 'CUSTOM_PPT_CONTENT');

    assert.strictEqual(clientService.getTenantTemplatePath(TEST_TENANT_ID), tenantTpl);

    // Remove custom template -> automatically falls back to master corporate template
    fs.unlinkSync(tenantTpl);
    const fallback = clientService.getTenantTemplatePath(TEST_TENANT_ID);
    assert.match(fallback, /master_template\.pptx/);
  });
});
