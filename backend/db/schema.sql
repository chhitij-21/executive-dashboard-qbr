-- Existing Inventory & Ticket Tables (Preserved)
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

CREATE TABLE IF NOT EXISTS reports_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  ticket_number TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  payload_json TEXT NOT NULL,
  bucket TEXT,
  ticket_type TEXT,
  job_id TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE(client_id, ticket_number)
);

-- ── Item #3 Unified Tables ──────────────────────────────────────────────────

-- 1. User Profiles & Credentials
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'client_user')),
  assigned_client TEXT NOT NULL,
  avatar TEXT,
  mfa_secret TEXT,
  mfa_enabled INTEGER DEFAULT 0,
  pending_mfa_secret TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. Scheduled QBRs (with AES-256-GCM Encrypted Recipients)
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('weekly', 'monthly', 'quarterly')),
  cron_expression TEXT NOT NULL,
  day_of_month INTEGER,
  day_of_week INTEGER,
  hour_utc INTEGER NOT NULL,
  recipients_encrypted TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tenant_id, name)
);

-- 3. Schedule Run History
CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  run_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('SCHEDULED', 'MANUAL')),
  cadence TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_label TEXT NOT NULL,
  days INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED')),
  job_id TEXT,
  dedup_key TEXT UNIQUE NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  download_url TEXT,
  dashboard_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4. Template Metadata & Manifests
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  UNIQUE(tenant_id, version)
);

-- Index optimization
CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_runs_tenant_schedule ON schedule_runs(tenant_id, schedule_id);
CREATE INDEX IF NOT EXISTS idx_templates_tenant_active ON templates(tenant_id, is_active);
