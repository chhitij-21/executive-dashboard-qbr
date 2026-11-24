// backend/routes/v1/docsRoutes.js
// OpenAPI 3.0.3 Schema Server & Self-Contained Interactive API Explorer UI (Item #23)

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const YAML = require('yaml');

const router = express.Router();

const SPEC_PATH = path.resolve(__dirname, '../../../docs/openapi-v1.yaml');

let _cachedRaw = null;
let _cachedSpec = null;
let _cachedMtimeMs = 0;

function loadOpenApiSpec() {
  const stats = fs.statSync(SPEC_PATH);
  if (_cachedSpec && stats.mtimeMs === _cachedMtimeMs) {
    return { rawYaml: _cachedRaw, spec: _cachedSpec };
  }
  const rawYaml = fs.readFileSync(SPEC_PATH, 'utf8');
  const spec = YAML.parse(rawYaml);
  _cachedRaw = rawYaml;
  _cachedSpec = spec;
  _cachedMtimeMs = stats.mtimeMs;
  return { rawYaml, spec };
}

function renderInteractiveDocsHtml(spec) {
  const title = (spec?.info?.title || 'Executive QBR Platform API').replace(/</g, '&lt;');
  const version = (spec?.info?.version || '1.0.0').replace(/</g, '&lt;');
  const description = (spec?.info?.description || '').replace(/</g, '&lt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Interactive API Docs</title>
  <style>
    :root {
      --bg: #0f172a; --surface: #1e293b; --surface-2: #0b1120;
      --border: #334155; --text: #f1f5f9; --muted: #94a3b8;
      --accent: #38bdf8; --get: #10b981; --post: #3b82f6;
      --put: #f59e0b; --patch: #a855f7; --delete: #ef4444;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    header { background: var(--surface-2); border-bottom: 1px solid var(--border); padding: 18px 28px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
    .brand h1 { margin: 0; font-size: 1.25rem; display: flex; align-items: center; gap: 10px; }
    .badge { font-size: 0.72rem; background: #0284c7; color: #fff; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    .brand p { margin: 4px 0 0; font-size: 0.85rem; color: var(--muted); max-width: 720px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .btn { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 7px 13px; border-radius: 6px; font-size: 0.82rem; cursor: pointer; text-decoration: none; font-weight: 600; }
    .btn:hover { border-color: var(--accent); color: var(--accent); }
    .btn-primary { background: #0284c7; border-color: #0284c7; color: #fff; }
    .btn-primary:hover { background: #0369a1; color: #fff; }
    .controls { max-width: 1180px; margin: 18px auto 0; padding: 0 20px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    input, select, textarea { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 11px; font-size: 0.85rem; }
    .controls input[type="search"] { flex: 1; min-width: 240px; }
    main { max-width: 1180px; margin: 18px auto 60px; padding: 0 20px; }
    .tag-group { margin-bottom: 22px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); overflow: hidden; }
    .tag-header { padding: 12px 18px; background: rgba(15, 23, 42, 0.55); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .tag-header h2 { margin: 0; font-size: 1rem; color: var(--accent); }
    .tag-header span { font-size: 0.8rem; color: var(--muted); }
    .op-item { border-bottom: 1px solid var(--border); }
    .op-item:last-child { border-bottom: none; }
    .op-row { width: 100%; text-align: left; background: transparent; border: none; color: inherit; padding: 11px 18px; display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 0.9rem; }
    .op-row:hover { background: rgba(56, 189, 248, 0.06); }
    .method { font-weight: 700; font-size: 0.72rem; text-transform: uppercase; min-width: 64px; text-align: center; padding: 4px 8px; border-radius: 5px; color: #fff; }
    .m-get { background: var(--get); } .m-post { background: var(--post); }
    .m-put { background: var(--put); color: #0f172a; } .m-patch { background: var(--patch); }
    .m-delete { background: var(--delete); }
    .op-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; font-size: 0.88rem; }
    .op-summary { color: var(--muted); font-size: 0.83rem; margin-left: auto; }
    .op-body { display: none; padding: 14px 18px 18px; background: var(--surface-2); border-top: 1px solid var(--border); }
    .op-item.open .op-body { display: block; }
    .param-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin: 10px 0 14px; }
    .param-field label { display: block; font-size: 0.76rem; color: var(--muted); margin-bottom: 4px; }
    .param-field input { width: 100%; }
    textarea.body-editor { width: 100%; min-height: 92px; font-family: ui-monospace, monospace; font-size: 0.8rem; margin-bottom: 10px; }
    pre.resp-box { background: #020617; border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-size: 0.78rem; overflow-x: auto; max-height: 320px; margin-top: 10px; }
    .auth-status { font-size: 0.8rem; color: #34d399; }
    .lock { font-size: 0.75rem; opacity: 0.85; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>${title} <span class="badge">v${version}</span> <span class="badge">OAS 3.0.3</span></h1>
      <p>${description}</p>
    </div>
    <div class="toolbar">
      <a class="btn" href="/api/v1/openapi.json" target="_blank">openapi.json</a>
      <a class="btn" href="/api/v1/openapi.yaml" target="_blank">openapi.yaml</a>
    </div>
  </header>

  <div class="controls">
    <select id="serverSelect" aria-label="Base Server URL">
      <option value="/api/v1">/api/v1 (Canonical)</option>
      <option value="/api">/api (Legacy Deprecated)</option>
    </select>
    <input id="jwtInput" type="password" placeholder="Paste Bearer JWT token (from POST /auth/login)" style="min-width:290px;" />
    <button id="saveTokenBtn" class="btn btn-primary" type="button">Set Bearer Token</button>
    <span id="authStatus" class="auth-status"></span>
    <input id="searchInput" type="search" placeholder="Filter endpoints (e.g. /anomalies, /webhooks, audit)..." />
  </div>

  <main id="apiRoot">Loading OpenAPI 3.0.3 specification...</main>

  <script>
    (function () {
      const root = document.getElementById('apiRoot');
      const searchInput = document.getElementById('searchInput');
      const serverSelect = document.getElementById('serverSelect');
      const jwtInput = document.getElementById('jwtInput');
      const authStatus = document.getElementById('authStatus');
      let bearerToken = sessionStorage.getItem('qbr_docs_jwt') || '';
      if (bearerToken) {
        jwtInput.value = bearerToken;
        authStatus.textContent = 'JWT Active';
      }

      document.getElementById('saveTokenBtn').addEventListener('click', () => {
        bearerToken = jwtInput.value.trim().replace(/^Bearer\\s+/i, '');
        if (bearerToken) {
          sessionStorage.setItem('qbr_docs_jwt', bearerToken);
          authStatus.textContent = 'JWT Active';
        } else {
          sessionStorage.removeItem('qbr_docs_jwt');
          authStatus.textContent = 'Cleared';
        }
      });

      function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
      }

      function renderSpec(spec, filterText) {
        const q = (filterText || '').trim().toLowerCase();
        const groups = new Map();
        (spec.tags || []).forEach(t => groups.set(t.name, { meta: t, ops: [] }));

        for (const [pathStr, pathItem] of Object.entries(spec.paths || {})) {
          for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
            const op = pathItem[method];
            if (!op) continue;
            const hay = (method + ' ' + pathStr + ' ' + (op.summary || '') + ' ' + (op.tags || []).join(' ')).toLowerCase();
            if (q && !hay.includes(q)) continue;
            const tagName = (op.tags && op.tags[0]) || 'General';
            if (!groups.has(tagName)) groups.set(tagName, { meta: { name: tagName, description: '' }, ops: [] });
            groups.get(tagName).ops.push({ method, pathStr, op });
          }
        }

        let html = '';
        for (const [tagName, group] of groups.entries()) {
          if (group.ops.length === 0) continue;
          html += '<section class="tag-group">';
          html += '<div class="tag-header"><h2>' + escapeHtml(tagName) + '</h2><span>' + escapeHtml(group.meta.description || '') + ' (' + group.ops.length + ')</span></div>';
          group.ops.forEach((item, idx) => {
            const opId = (tagName + '-' + item.method + '-' + idx).replace(/[^a-zA-Z0-9_-]/g, '_');
            const isPublic = Array.isArray(item.op.security) && item.op.security.length === 0;
            const params = item.op.parameters || [];
            html += '<div class="op-item" data-op-id="' + opId + '">';
            html += '<button class="op-row" type="button">';
            html += '<span class="method m-' + item.method + '">' + item.method.toUpperCase() + '</span>';
            html += '<span class="op-path">' + escapeHtml(item.pathStr) + '</span>';
            html += '<span class="lock">' + (isPublic ? 'Public' : 'Auth') + '</span>';
            html += '<span class="op-summary">' + escapeHtml(item.op.summary || '') + '</span>';
            html += '</button>';
            html += '<div class="op-body">';
            if (item.op.description) html += '<p style="margin-top:0;color:var(--muted);font-size:0.84rem;">' + escapeHtml(item.op.description) + '</p>';
            if (params.length > 0) {
              html += '<div class="param-grid">';
              params.forEach(p => {
                html += '<div class="param-field"><label>' + escapeHtml(p.name) + ' (' + escapeHtml(p.in) + (p.required ? ', required' : '') + ')</label>';
                html += '<input type="text" data-param-in="' + escapeHtml(p.in) + '" data-param-name="' + escapeHtml(p.name) + '" placeholder="' + escapeHtml(p.description || '') + '" /></div>';
              });
              html += '</div>';
            }
            if (['post', 'put', 'patch'].includes(item.method)) {
              html += '<label style="display:block;font-size:0.76rem;color:var(--muted);margin-bottom:4px;">JSON Request Body</label>';
              html += '<textarea class="body-editor">{}</textarea>';
            }
            html += '<button class="btn btn-primary exec-btn" type="button" data-method="' + item.method.toUpperCase() + '" data-path="' + escapeHtml(item.pathStr) + '">Execute Request</button>';
            html += '<pre class="resp-box" style="display:none;"></pre>';
            html += '</div></div>';
          });
          html += '</section>';
        }
        root.innerHTML = html || '<p style="color:var(--muted);">No matching endpoints.</p>';

        root.querySelectorAll('.op-row').forEach(btn => {
          btn.addEventListener('click', () => btn.closest('.op-item').classList.toggle('open'));
        });
        root.querySelectorAll('.exec-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const box = btn.closest('.op-body');
            const respEl = box.querySelector('.resp-box');
            respEl.style.display = 'block';
            respEl.textContent = 'Executing...';
            let targetPath = btn.getAttribute('data-path');
            const queryPairs = [];
            box.querySelectorAll('input[data-param-name]').forEach(inp => {
              const val = inp.value.trim();
              if (!val) return;
              const pIn = inp.getAttribute('data-param-in');
              const pName = inp.getAttribute('data-param-name');
              if (pIn === 'path') targetPath = targetPath.replace('{' + pName + '}', encodeURIComponent(val));
              else if (pIn === 'query') queryPairs.push(encodeURIComponent(pName) + '=' + encodeURIComponent(val));
            });
            const url = serverSelect.value + targetPath + (queryPairs.length ? '?' + queryPairs.join('&') : '');
            const headers = {};
            if (bearerToken) headers['Authorization'] = 'Bearer ' + bearerToken;
            const opts = { method: btn.getAttribute('data-method'), headers };
            const bodyArea = box.querySelector('.body-editor');
            if (bodyArea) {
              headers['Content-Type'] = 'application/json';
              opts.body = bodyArea.value;
            }
            try {
              const r = await fetch(url, opts);
              const txt = await r.text();
              let formatted = txt;
              try { formatted = JSON.stringify(JSON.parse(txt), null, 2); } catch (_) {}
              respEl.textContent = 'HTTP ' + r.status + ' ' + r.statusText + '\\n\\n' + formatted;
            } catch (e) {
              respEl.textContent = 'Request failed: ' + e.message;
            }
          });
        });
      }

      fetch('/api/v1/openapi.json')
        .then(r => r.json())
        .then(spec => {
          renderSpec(spec, '');
          searchInput.addEventListener('input', () => renderSpec(spec, searchInput.value));
        })
        .catch(err => {
          root.textContent = 'Failed to load OpenAPI spec: ' + err.message;
        });
    })();
  </script>
</body>
</html>`;
}

router.get(['/openapi.json', '/api/openapi.json'], (_req, res) => {
  try {
    const { spec } = loadOpenApiSpec();
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load OpenAPI specification', message: err.message });
  }
});

router.get(['/openapi.yaml', '/api/openapi.yaml'], (_req, res) => {
  try {
    const { rawYaml } = loadOpenApiSpec();
    res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
    res.send(rawYaml);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load OpenAPI YAML', message: err.message });
  }
});

router.get(['/docs', '/api/docs'], (_req, res) => {
  try {
    const { spec } = loadOpenApiSpec();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderInteractiveDocsHtml(spec));
  } catch (err) {
    res.status(500).send(`Failed to render API documentation: ${err.message}`);
  }
});

module.exports = router;

