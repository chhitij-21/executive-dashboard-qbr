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
  uploaded_at TEXT NOT NULL,
  UNIQUE(client_id, ticket_number)
);

