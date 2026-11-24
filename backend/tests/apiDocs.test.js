require('./_setup');
// backend/tests/apiDocs.test.js
// OpenAPI 3.0.3 Specification, Interactive Explorer & Onboarding Guide Suite (Item #23)

process.env.NODE_ENV = 'test';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const app = require('../index');

describe('OpenAPI / Swagger API Documentation & Onboarding Guide (Item #23)', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('1. docs/openapi-v1.yaml is valid OpenAPI 3.0.3 and covers all platform modules', () => {
    const specPath = path.resolve(__dirname, '../../docs/openapi-v1.yaml');
    assert.ok(fs.existsSync(specPath), 'docs/openapi-v1.yaml must exist');
    const raw = fs.readFileSync(specPath, 'utf8');
    const spec = YAML.parse(raw);

    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.info?.title);
    assert.ok(spec.components?.securitySchemes?.BearerAuth);
    assert.ok(spec.components?.securitySchemes?.MerakiWebhookHmac);
    assert.ok(spec.components?.securitySchemes?.CatalystWebhookHmac);

    const requiredPaths = [
      '/health',
      '/health/live',
      '/health/ready',
      '/auth/login',
      '/dashboard',
      '/anomalies',
      '/audit',
      '/audit/export',
      '/connectors',
      '/webhooks/meraki/{connectorId}',
      '/webhooks/catalyst/{connectorId}',
      '/webhooks/buffered-incidents',
      '/docs',
      '/openapi.json',
      '/openapi.yaml',
    ];
    for (const p of requiredPaths) {
      assert.ok(spec.paths[p], `OpenAPI spec must document path: ${p}`);
    }
  });

  it('2. GET /api/v1/openapi.json serves compiled OpenAPI 3.0.3 JSON without auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/openapi.json`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('application/json'));
    const body = await res.json();
    assert.equal(body.openapi, '3.0.3');
    assert.ok(body.paths['/anomalies']);
    assert.ok(body.paths['/connectors']);
  });

  it('3. GET /api/v1/openapi.yaml serves raw OpenAPI YAML specification', async () => {
    const res = await fetch(`${baseUrl}/api/v1/openapi.yaml`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('yaml'));
    const text = await res.text();
    assert.ok(text.includes('openapi: 3.0.3'));
    assert.ok(text.includes('/webhooks/meraki/{connectorId}:'));
  });

  it('4. GET /api/v1/docs serves self-contained interactive API explorer HTML', async () => {
    const res = await fetch(`${baseUrl}/api/v1/docs`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const html = await res.text();
    assert.ok(html.includes('OAS 3.0.3'));
    assert.ok(html.includes('/api/v1/openapi.json'));
    assert.ok(html.includes('Set Bearer Token'));
    assert.ok(!html.includes('https://unpkg.com'), 'Must be 100% self-contained without CDN dependency');
  });

  it('5. GET /docs redirects cleanly to /api/v1/docs', async () => {
    const res = await fetch(`${baseUrl}/docs`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/api/v1/docs');
  });

  it('6. Legacy /api/openapi.json emits RFC 8594 Deprecation headers', async () => {
    const res = await fetch(`${baseUrl}/api/openapi.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('deprecation'), 'true');
    assert.ok(res.headers.get('link')?.includes('/api/v1/openapi.json'));
  });

  it('7. docs/ONBOARDING_GUIDE.md exists and covers auth, multi-tenancy, anomalies, and webhooks', () => {
    const guidePath = path.resolve(__dirname, '../../docs/ONBOARDING_GUIDE.md');
    assert.ok(fs.existsSync(guidePath), 'docs/ONBOARDING_GUIDE.md must exist');
    const md = fs.readFileSync(guidePath, 'utf8');
    assert.ok(md.includes('/api/v1/auth/login'));
    assert.ok(md.includes('x-meraki-signature'));
    assert.ok(md.includes('/api/v1/anomalies'));
    assert.ok(md.includes('CUSTOMER_ACCESS_FORBIDDEN'));
  });
});

