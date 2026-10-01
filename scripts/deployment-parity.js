'use strict';
// scripts/deployment-parity.js
// Compares structured responses between ENV A and ENV B.
// Usage:
//   node scripts/deployment-parity.js
//   ENV_A=http://localhost:3001 ENV_B=https://x.example.com node scripts/deployment-parity.js

const crypto = require('crypto');

const ENV_A = process.env.ENV_A || 'http://localhost:3000';
const ENV_B = process.env.ENV_B || 'https://executive-dashboard-qbr-2.onrender.com';

const ROUTES = [
  '/api/health',
  '/api/dashboard',
  '/api/dashboard?site=Bangalore',
  '/api/dashboard?site=Greater%20Noida',
  '/api/dashboard?site=Noida',
  '/api/dashboard?site=Mohali',
  '/api/dashboard?site=Hyderabad',
  '/api/dashboard?site=Nagpur',
  '/api/dashboard?site=Mumbai-DC',
  '/api/dashboard?site=Guwahati',
  '/api/dashboard?jobId=latest',
  '/api/rules',
  '/api/auth/demo-accounts',
  '/api/history',
  '/api/clients',
  '/api/chat/loop?prompt=ping',
];

const NORMALIZE_FIELDS = ['jobId', 'generatedAt', 'ts', 'timestamp', 'duration_ms'];

function stripDynamic(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripDynamic);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (NORMALIZE_FIELDS.includes(k)) continue;
    out[k] = stripDynamic(v);
  }
  return out;
}

function stripSseDynamic(text) {
  return text
    .split('\n')
    .map(line => line
      .replace(/"ts"\s*:\s*"[^"]*"/g, '"ts":"<TS>"')
      .replace(/"timestamp"\s*:\s*"[^"]*"/g, '"timestamp":"<TS>"')
      .replace(/"duration_ms"\s*:\s*\d+/g, '"duration_ms":0')
    )
    .join('\n');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function fetchOne(base, route) {
  const url = base.replace(/\/+$/, '') + route;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, text, ct, ok: true };
  } catch (e) {
    return { status: 0, text: '', ct: '', ok: false, err: e.message };
  }
}

function normalizeForRoute(route, side) {
  if (!side.ok) return '';
  if (side.ct.includes('text/event-stream') || route.includes('/api/chat/loop')) {
    return stripSseDynamic(side.text);
  }
  try {
    const j = JSON.parse(side.text);
    return JSON.stringify(stripDynamic(j));
  } catch {
    return side.text;
  }
}

async function main() {
  const rows = [];
  let anyFail = false;

  for (const route of ROUTES) {
    const [a, b] = await Promise.all([
      fetchOne(ENV_A, route),
      fetchOne(ENV_B, route),
    ]);

    if (!a.ok || !b.ok) {
      rows.push({ route, status: 'UNREACHABLE',
        aStatus: a.status, bStatus: b.status,
        aRaw: '', bRaw: '', aNorm: '', bNorm: '' });
      continue;
    }

    const aRawHash = sha256(a.text);
    const bRawHash = sha256(b.text);
    const aNormHash = sha256(normalizeForRoute(route, a));
    const bNormHash = sha256(normalizeForRoute(route, b));

    const statusMatch = a.status === b.status;
    const normMatch   = aNormHash === bNormHash;
    const verdict     = (statusMatch && normMatch) ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') anyFail = true;

    rows.push({ route, status: verdict,
      aStatus: a.status, bStatus: b.status,
      aRaw: aRawHash.slice(0, 12), bRaw: bRawHash.slice(0, 12),
      aNorm: aNormHash.slice(0, 12), bNorm: bNormHash.slice(0, 12),
      aExcerpt: a.text.slice(0, 200),
      bExcerpt: b.text.slice(0, 200),
    });
  }

  console.log('');
  console.log('Deployment Parity — ' + ENV_A + ' vs ' + ENV_B);
  console.log('');
  console.log(['Route'.padEnd(46), 'A', 'B', 'Verdict'].join(' | '));
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log([
      r.route.padEnd(46),
      String(r.aStatus).padStart(3),
      String(r.bStatus).padStart(3),
      r.status,
    ].join(' | '));
  }

  const fails = rows.filter(r => r.status === 'FAIL');
  if (fails.length > 0) {
    console.log('');
    console.log('First FAIL excerpt:');
    console.log('  A: ' + fails[0].aExcerpt.replace(/\s+/g, ' '));
    console.log('  B: ' + fails[0].bExcerpt.replace(/\s+/g, ' '));
  }

  console.log('');
  console.log('PASS: ' + rows.filter(r => r.status === 'PASS').length);
  console.log('FAIL: ' + fails.length);
  console.log('UNREACHABLE: ' + rows.filter(r => r.status === 'UNREACHABLE').length);

  process.exit(anyFail ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
