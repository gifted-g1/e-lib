package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- A child laptop. token_hash authenticates it; hardware_id is the laptop's own device id.
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  hardware_id TEXT,
  last_seen_at TEXT,
  app_version TEXT,
  daily_limit_minutes INTEGER NOT NULL DEFAULT 0,
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  schedule_start TEXT NOT NULL DEFAULT '08:00',
  schedule_end TEXT NOT NULL DEFAULT '20:00',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Child profiles as reported by each laptop (profiles are created on the laptop).
CREATE TABLE IF NOT EXISTS device_children (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  age INTEGER,
  avatar TEXT,
  PRIMARY KEY (device_id, local_id)
);

CREATE TABLE IF NOT EXISTS device_usage (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  child_local_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  PRIMARY KEY (device_id, child_local_id, day)
);

-- "Give N more minutes today" sent from the parent app.
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  key TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('video', 'pdf', 'site')),
  source_url TEXT,
  file_key TEXT,
  thumbnail_url TEXT,
  thumb_file_key TEXT,
  description TEXT,
  allowed_domains TEXT,
  is_approved INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- status = what the parent sees/decided; device_status = what the laptop last reported.
-- A decision is delivered to the laptop while status <> device_status.
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL,
  child_local_id INTEGER,
  content_remote_id TEXT,
  content_title TEXT NOT NULL,
  content_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  device_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT,
  resolved_at TEXT,
  UNIQUE (device_id, local_id)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL,
  child_local_id INTEGER,
  content_remote_id TEXT,
  content_title TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  timestamp TEXT,
  UNIQUE (device_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_content_account ON content(account_id, category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_activity_device_time ON activity(device_id, timestamp);
`

func openDB(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows one writer; a single connection keeps things simple and avoids SQLITE_BUSY.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

// queryMaps runs a query and returns each row as a column->value map (for JSON responses).
func queryMaps(db queryer, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			if b, ok := vals[i].([]byte); ok {
				m[c] = string(b)
			} else {
				m[c] = vals[i]
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}
