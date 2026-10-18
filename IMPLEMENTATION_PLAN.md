# Phase G Implementation Plan: Inventory Sync (Turso Database)

## 1. Problem Statement & Architecture
Enterprise clients periodically upgrade, decommission, and reassign switches and access points across branch sites. Phase G introduces a persistent Turso (libSQL/SQLite) inventory database to track device lifecycle changes, hardware replacements, and configuration drift across reporting quarters.

The system matches devices by hardware Serial Number (`serial_no`), computes granular diffs (`added`, `removed`, `replaced`, `unchanged`), stages uploads as `pending` syncs for administrator approval, and provides snapshot-based rollback without impacting existing PDF/PPT generation or multi-tenant isolation.

---

## 2. Verbatim 4-Table Database Schema (`backend/db/schema.sql`)
The database schema uses the original 4-table specification verbatim with zero additional or altered columns:

```sql
CREATE TABLE IF NOT EXISTS inventory_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  serial_no TEXT NOT NULL,
  mac_address TEXT,
  cloud_id TEXT,
  hostname TEXT,
  device_type TEXT,
  model TEXT,
  site_id TEXT,
  rack_location TEXT,
  status TEXT DEFAULT 'active',
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  last_sync_id INTEGER,
  UNIQUE (client_id, serial_no)
);

CREATE TABLE IF NOT EXISTS inventory_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  triggered_by TEXT,
  uploaded_file_name TEXT,
  diff_summary TEXT, 
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER REFERENCES inventory_syncs(id),
  client_id TEXT NOT NULL,
  serial_no TEXT,
  change_type TEXT, 
  before_state TEXT, 
  after_state TEXT, 
  changed_fields TEXT, 
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER,
  client_id TEXT NOT NULL,
  snapshot_data TEXT, 
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 3. Strict Database Client (`backend/config/database.js`)
- Initializes libSQL client via `createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })`.
- **STRICT TURSO ONLY** (No silent local SQLite file fallback in production).
- If `TURSO_DATABASE_URL` is missing: throws an immediate, fatal startup error:
  ```javascript
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error('[FATAL] Missing TURSO_DATABASE_URL environment variable. Turso connection is strictly required.');
  }
  ```
- Exports: `db`, `execute(sql, args)`, `transaction(fn)`, `healthCheck()`.
- For unit testing (`backend/tests/inventorySync.test.js`), in-memory SQLite (`file::memory:?cache=shared`) is used directly in test setup so CI/unit tests run offline, deterministically, and fast without hitting production Turso.

---

## 4. Per-Client Mapping & Migration Script (`backend/scripts/migrate-existing-inventories.js`)
One unified script with two distinct, per-client column mappers tailored to source Excel ground truth:

### A. JFL Mapper (`mapJFLRow`)
```javascript
function mapJFLRow(row) {
  return {
    client_id: 'jfl',
    serial_no: String(row['Serial No.'] || '').trim(),
    mac_address: row['MAC Address'] ? String(row['MAC Address']).trim() : null,
    cloud_id: row['Network ID'] ? String(row['Network ID']).trim() : null,
    hostname: row['Hostname'] ? String(row['Hostname']).trim() : null,
    device_type: row['Device Type'] ? String(row['Device Type']).trim() : null,
    model: row['Model'] ? String(row['Model']).trim() : null,
    site_id: row['Location'] ? String(row['Location']).trim() : null,
    rack_location: row['Rack no.'] ? String(row['Rack no.']).trim() : null,
    status: row['Hostname'] === 'STOCK'               ? 'stock'
          : row['Rack no.'] === 'Not Cover with us'   ? 'not_covered'
          : row['Faulty Serial no']                   ? 'faulty'
          : 'active',
  };
}
```

### B. MMTC Mapper (`mapMMTCRow`)
```javascript
function deriveDeviceType(model) {
  if (!model) return 'SW';
  const m = String(model).trim();
  if (/^MR/i.test(m)) return 'AP';
  if (/^MS|^C9300|^C9200/i.test(m)) return 'SW';
  if (/^MX/i.test(m)) return 'Router';
  return 'SW';
}

function deriveMMTCSite(network) {
  if (!network) return 'Unknown';
  let s = String(network).trim();
  // Strip leading prefixes
  s = s.replace(/^(IND|INDIA)-/i, '');
  // Strip intermediate tokens
  s = s.replace(/PVC-/i, '');
  s = s.replace(/-PLANT.*$/i, '');
  s = s.replace(/-HEAD-OFFICE.*$/i, '');
  s = s.replace(/-IT.*$/i, '');
  return s.toUpperCase().trim() || 'Unknown';
}

function mapMMTCRow(row) {
  return {
    client_id: 'mmtc',
    serial_no: String(row['Cloud ID'] || '').trim(), // REQUIRED unique device serial
    mac_address: row['MAC address'] ? String(row['MAC address']).trim() : null,
    cloud_id: null,                                 // no source
    hostname: null,                                 // no source
    device_type: deriveDeviceType(row['Model']),
    model: row['Model'] ? String(row['Model']).trim() : null,
    site_id: deriveMMTCSite(row['Network']),
    rack_location: null,                            // no source
    status: 'active',
  };
}
```

### C. Migration Verification & Hard-Abort Gate
The migration runs inside a transaction or rolls back completely if any invariant fails:
```javascript
const checks = [
  { sql: "SELECT COUNT(*) as cnt FROM inventory_devices WHERE client_id='jfl'", expected: 444, label: 'JFL total devices' },
  { sql: "SELECT COUNT(*) as cnt FROM inventory_devices WHERE client_id='jfl' AND status='active'", expected: 372, label: 'JFL active devices' },
  { sql: "SELECT COUNT(DISTINCT site_id) as cnt FROM inventory_devices WHERE client_id='jfl'", expected: 8, label: 'JFL unique sites' },
  { sql: "SELECT COUNT(*) as cnt FROM inventory_devices WHERE client_id='mmtc'", expected: 145, label: 'MMTC total devices' },
  { sql: "SELECT COUNT(DISTINCT site_id) as cnt FROM inventory_devices WHERE client_id='mmtc'", expected: 21, label: 'MMTC unique sites' },
];

for (const chk of checks) {
  const res = await db.execute(chk.sql);
  const actual = Number(res.rows[0].cnt);
  if (actual !== chk.expected) {
    throw new Error(`[MIGRATION ABORT] Invariant failed for ${chk.label}: expected ${chk.expected}, got ${actual}. Rolling back entire migration.`);
  }
}
```

---

## 5. Diff Engine Rules (`backend/services/inventorySyncService.js`)
Matching key is `serial_no`:
1. **Added**: `serial_no` exists in new upload, does not exist in DB for `client_id`.
2. **Removed**: `serial_no` exists in DB with `status='active'`, but is missing from new upload.
3. **Replaced**: `serial_no` matches, but ANY of the following fields changed:
   - `mac_address`, `cloud_id`, `hostname`, `device_type`, `model`, `site_id`, `rack_location`
   - **Status changes** (`active` ↔ `stock` ↔ `faulty` ↔ `not_covered`) are ALSO categorized as **`replaced`** (not removed), because the serial number remains present.
4. **Unchanged**: `serial_no` matches and all comparison fields + status are identical.

---

## 6. Dashboard Query Contract (`GET /api/inventory/current`)
- Route: `GET /api/inventory/current?clientId=:clientId[&include=all]`
- **Default**: Returns **ONLY `status = 'active'`** devices. (Ensures JFL returns exactly 372 active devices).
- **`?include=all`**: Returns all 444 devices including `stock`, `faulty`, and `not_covered`.
- Stored `diff_summary` in `inventory_syncs`: JSON object containing counts `{ added, removed, replaced, unchanged }`.

---

## 7. API Routes (`backend/routes/inventorySync.js`)
Protected by `requireAuth` and `requireClientAccess`:
- `POST /api/inventory/sync/upload`: Parses file with appropriate client mapper, runs `computeDiff`, saves `inventory_syncs` (`status='pending'`) and `inventory_history` preview records.
- `GET /api/inventory/sync/:syncId`: Returns sync preview including `diff_summary` and changed fields.
- `POST /api/inventory/sync/:syncId/approve`: Takes snapshot of pre-sync state in `inventory_snapshots`, applies changes to `inventory_devices`, marks sync `approved`.
- `POST /api/inventory/sync/:syncId/reject`: Marks sync `rejected`.
- `GET /api/inventory/syncs`: Lists past sync history for client.
- `GET /api/inventory/current`: Returns current inventory adhering to query contract (default active, `?include=all`).

---

## 8. Frontend Interface (`frontend/src/components/InventorySyncPage.jsx`)
- Dedicated "Inventory Sync" tab in navigation.
- Client selector (`JFL` / `MMTC`) + Turso DB live health indicator.
- File uploader accepting new inventory spreadsheet.
- Visual Diff Preview Cards: Added (Green), Removed (Red), Replaced (Amber), Unchanged (Slate).
- Detailed side-by-side table displaying exact changed fields (`before` → `after`).
- "Approve & Update DB" button and "Cancel / Reject" button.
- Sync History audit table with "Rollback to Snapshot" capability.
- Active Inventory table toggleable between "Active Only" (372) and "All Devices" (444).

---

## 9. 8 Unit & Integration Tests (`backend/tests/inventorySync.test.js`)
Tests scale from 82/82 to 90/90 pass using in-memory database:
1. `computeDiff` detects added device (JFL-shaped row).
2. `computeDiff` detects removed device (JFL-shaped row).
3. `computeDiff` detects replaced — MAC change.
4. `computeDiff` detects replaced — status change (`active` → `stock`, serial still present).
5. `computeDiff` detects unchanged (identical row).
6. `approveSync` inserts on real DB (in-memory SQLite) — verifies snapshot row created, device counts match, and `inventory_history` rows written per change.
7. `rollbackToSnapshot` restores from snapshot.
8. Multi-tenant isolation — MMTC sync cannot see JFL rows; JFL approve cannot affect MMTC devices.

---

## 10. Verification Invariants
- Existing `POST /api/upload`, `processData.js`, `pptGenerator.js`, `pdfGenerator.js` untouched.
- Vulnerabilities and MFA flows untouched.
- Backend tests: 82/82 → 90/90 pass.
- Frontend build: passes with zero errors.
