require('./_setup');
// backend/tests/typescriptContracts.test.js
// Verifies compiled shared TypeScript + Zod contracts and Phase 1 TS module hygiene.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const DIST_SCHEMAS_PATH = path.join(ROOT_DIR, 'shared', 'dist', 'schemas', 'qbrSchemas.js');

describe('Phase 1 TypeScript + Zod Shared Contracts', () => {
  let schemas;

  before(() => {
    if (!fs.existsSync(DIST_SCHEMAS_PATH)) {
      execSync('npx tsc -p tsconfig.shared.json', { cwd: ROOT_DIR, stdio: 'pipe' });
    }
    assert.ok(fs.existsSync(DIST_SCHEMAS_PATH), 'Compiled shared Zod schemas must exist');
    schemas = require(DIST_SCHEMAS_PATH);
  });

  it('validates custom DateRangeSchema boundaries cleanly', () => {
    const valid = schemas.DateRangeSchema.safeParse({
      start_date: '2026-07-01',
      end_date: '2026-07-31',
    });
    assert.equal(valid.success, true);

    const sameDay = schemas.DateRangeSchema.safeParse({
      start_date: '2026-07-15',
      end_date: '2026-07-15',
    });
    assert.equal(sameDay.success, true);

    const reversed = schemas.DateRangeSchema.safeParse({
      start_date: '2026-07-31',
      end_date: '2026-07-01',
    });
    assert.equal(reversed.success, false);

    const malformed = schemas.DateRangeSchema.safeParse({
      start_date: '01/07/2026',
      end_date: '2026-07-31',
    });
    assert.equal(malformed.success, false);
  });

  it('validates AnomalySchema, AnomalySummarySchema, and ImpactWeightedRcaSchema', () => {
    const anomaly = schemas.AnomalySchema.safeParse({
      id: 'anom-flap-001',
      severity: 'CRITICAL',
      type: 'DEVICE_FLAPPING',
      entity: { site: 'Mumbai-HQ', device: 'SW-CORE-01' },
      message: 'Repeated link state flaps detected in reporting period',
      evidence: { incidentCount: 6, totalMinutes: 145 },
      recommendation: 'Inspect SFP optics and uplink port negotiation',
    });
    assert.equal(anomaly.success, true);

    const badSeverity = schemas.AnomalySchema.safeParse({
      id: 'anom-bad',
      severity: 'EXTREME',
      type: 'DEVICE_FLAPPING',
      entity: {},
      message: 'Invalid severity',
    });
    assert.equal(badSeverity.success, false);

    const summary = schemas.AnomalySummarySchema.safeParse({
      total: 3,
      critical: 1,
      high: 1,
      medium: 1,
      low: 0,
    });
    assert.equal(summary.success, true);

    const impact = schemas.ImpactWeightedRcaSchema.safeParse({
      rca: 'Power Issue',
      totalMinutes: 420.5,
      percentage: '62.5%',
    });
    assert.equal(impact.success, true);
  });

  it('validates WebhookConnectorCreateSchema providers and name trimming', () => {
    const created = schemas.WebhookConnectorCreateSchema.parse({
      provider: 'meraki',
      name: '  Meraki Production Alerts  ',
      clientId: 'jfl',
    });
    assert.equal(created.name, 'Meraki Production Alerts');
    assert.equal(created.provider, 'meraki');

    const badProvider = schemas.WebhookConnectorCreateSchema.safeParse({
      provider: 'unknown_vendor',
      name: 'Invalid',
    });
    assert.equal(badProvider.success, false);

    const emptyName = schemas.WebhookConnectorCreateSchema.safeParse({
      provider: 'catalyst_center',
      name: '   ',
    });
    assert.equal(emptyName.success, false);
  });

  it('coerces and bounds AuditQuerySchema query parameters', () => {
    const parsed = schemas.AuditQuerySchema.parse({
      severity: 'WARN',
      status: 'FAILURE',
      limit: '100',
      offset: '20',
    });
    assert.equal(parsed.limit, 100);
    assert.equal(parsed.offset, 20);

    const overLimit = schemas.AuditQuerySchema.safeParse({ limit: '1000' });
    assert.equal(overLimit.success, false);
  });

  it('ensures migrated TS/TSX frontend files have no legacy JS/JSX shadow files', () => {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'frontend/src/config/api.js')), 'Runtime ESM api.js must exist');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'frontend/src/config/api.d.ts')), 'TypeScript declaration api.d.ts must exist');

    const pairs = [
      ['frontend/src/main.tsx', 'frontend/src/main.jsx'],
      ['frontend/src/components/AuditLogsPanel.tsx', 'frontend/src/components/AuditLogsPanel.jsx'],
      ['frontend/src/components/ConnectorsPanel.tsx', 'frontend/src/components/ConnectorsPanel.jsx'],
    ];

    for (const [tsRel, legacyRel] of pairs) {
      assert.ok(fs.existsSync(path.join(ROOT_DIR, tsRel)), `Missing TypeScript module: ${tsRel}`);
      assert.equal(
        fs.existsSync(path.join(ROOT_DIR, legacyRel)),
        false,
        `Legacy shadow file should be removed: ${legacyRel}`
      );
    }
  });
});
