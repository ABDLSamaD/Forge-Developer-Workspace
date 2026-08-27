# Database

Forge stores everything in a single SQLite database using `better-sqlite3`
(synchronous, transactional, zero-administration).

## Location

The database lives in Electron's per-user application data directory — never
inside the source tree, never inside the installed binaries:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\forge-workspace\forge.db` |
| macOS | `~/Library/Application Support/forge-workspace/forge.db` |
| Linux | `~/.config/forge-workspace/forge.db` |

Resolved at runtime via `app.getPath("userData")`; no OS-specific paths are
hard-coded.

```
userData/
├── forge.db          main database (WAL mode)
├── forge.db-wal      write-ahead log (transient)
├── backups/          automatic snapshots + restore source
└── forge-data.json   legacy file — migrated once, never deleted or rewritten
```

Development and production use **separate databases** (Electron's userData is
per-application-profile), so test data never leaks into packaged builds.

## Schema (migration 001)

```sql
meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
schema_migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)

projects(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',        -- active | on-hold | completed
  priority TEXT DEFAULT 'medium',
  color TEXT,                          -- #rrggbb or NULL
  start_date TEXT,                     -- ISO yyyy-mm-dd or NULL
  target_date TEXT,
  tags TEXT DEFAULT '[]',              -- JSON array
  position INTEGER NOT NULL,           -- persisted display order
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

tasks(
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'planned',       -- 8-state workflow
  priority TEXT DEFAULT 'medium',      -- critical | high | medium | low
  type TEXT DEFAULT 'other',
  effort TEXT DEFAULT 'medium',        -- small | medium | large
  tags TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  start_date TEXT,
  due_date TEXT,
  completed_at INTEGER,
  archived INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

activity_log(
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,                -- task | project | system
  entity_id TEXT,
  action TEXT NOT NULL,
  title TEXT DEFAULT '',
  details TEXT,
  at INTEGER NOT NULL                  -- epoch ms; capped to newest 800 rows
)

settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)  -- JSON-encoded values
```

Indexes: `projects(position)`, `tasks(project_id)`, `tasks(status)`,
`tasks(due_date)`, `tasks(position)`, `activity_log(at)`.

## Migrations

- Versioned, deterministic, ordered in `db.js` (`MIGRATIONS` array).
- Applied inside transactions; the `schema_migrations` row commits atomically
  with the schema change.
- Unknown/future migrations are never guessed: each runs exactly once, tracked
  by name.
- Adding a migration = appending `{ name, up(db) }`. Existing installs upgrade
  on next launch with no manual steps.

## Legacy JSON migration

On first launch after upgrading:

1. If `meta.json_migrated_at` exists → skip (marker survives resets).
2. Read `forge-data.json` (current format) or fall back to pre-Forge
   `todos.json` (plain task array).
3. Run every record through the same sanitizers used for live data
   (enum whitelists, date validation, tag normalization, orphan-project
   detachment, duplicate-ID handling).
4. Replace the empty database contents in one transaction.
5. Write the marker. Log a system activity entry.

Rules:

- The JSON files are **never modified or deleted** — they become inert history.
- Migration is idempotent; if it fails mid-way the transaction rolls back and
  it will retry cleanly on next launch.
- Consequence of keeping the marker: downgrading to ≤3.0.x reads the stale
  JSON and misses changes made under 3.1+. Export/import bridges that gap.

## Backup & restore

### Automatic

- Once per 24h at launch (timestamp tracked in `meta.last_auto_backup`).
- Uses better-sqlite3's online backup API — a consistent, self-contained copy
  even while WAL is active. Never blocks startup on failure.
- Stored in `userData/backups/forge-auto-YYYY-MM-DD-HHMMSS.db`.
- Retention keeps the newest 10; older ones are removed automatically.

### Manual

Settings → Database Backups → *Save backup now…* writes a `.db` snapshot to a
user-chosen location via the native save dialog. Portable across machines.

### Restore

*Restore from backup…* validates the chosen file before touching anything:

1. Open read-only; require all four core tables to exist.
2. Close the live connection (releases Windows file locks).
3. Copy the snapshot over `forge.db` via temp file + rename, keeping the
   previous database as `forge.db.pre-restore` until the swap succeeds.
4. Relaunch the app so a fresh connection opens on restored data.

### JSON export/import (portable format)

Still available and unchanged in behaviour — now round-trips through SQLite.
JSON export is a human-readable portable snapshot, not the primary backup
mechanism.

## Integrity notes

- All queries use prepared statements / bound parameters — no string-built SQL.
- Foreign keys enforced per connection (`PRAGMA foreign_keys = ON`).
- `busy_timeout = 5000ms` guards against transient lock contention.
- Every write path used by the app goes through `db.js`; nothing else opens
  the database file.
