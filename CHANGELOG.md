# Changelog

## 3.1.0 — SQLite storage engine (2026-08-26)

### Storage

- **Migrated persistence from a JSON file to SQLite** (`better-sqlite3`,
  WAL journal). All data now lives in `userData/forge.db`.
- Versioned, transactional migration system
  (`db.js` → `schema_migrations` table).
- **Automatic one-time import of legacy `forge-data.json` / `todos.json`**
  on first launch. Original files are validated, sanitized and imported in a
  single transaction; they are never modified or deleted.
- List ordering is now persisted (`position` column) — create/duplicate/undo
  order survives restarts exactly as displayed.

### Backup & restore

- Daily automatic database snapshots with 10-copy retention
  (`userData/backups/forge-auto-*.db`), taken via SQLite's consistent online
  backup API.
- New Settings section **Database Backups**: *Save backup now…*, *Open backups
  folder*, and *Restore from backup…* (validates the snapshot, swaps the file,
  relaunches the app).
- JSON export/import remains available as the portable human-readable format.

### Security

- Navigation is now restricted to the bundled renderer directory (was: any
  `file://` URL); popup blocking and external-link handling moved to a
  defense-in-depth `web-contents-created` handler covering all future windows.
- Clean database shutdown on quit; restore path validates before overwriting.

### Packaging

- `better-sqlite3` added as the sole runtime dependency; Electron-ABI binary
  selected automatically via `postinstall` → `electron-builder install-app-deps`.
- `asarUnpack` configured for the native module.

### Tests

- New integration suite (`npm test`) covering migration, CRUD round-trips,
  ordering, undo, project-delete detach, backups and foreign-key enforcement —
  runs against an isolated temp profile inside Electron.

### Upgrade notes

- First launch after upgrade performs the JSON→SQLite migration automatically.
  Do not delete `forge-data.json`; it is kept as inert history.
- Downgrading to ≤3.0.x would read the stale JSON file and miss changes made
  under 3.1+. Use Export/Import to bridge if ever needed.

## 3.0.x — JSON era

Schema v3 JSON persistence (`forge-data.json`), audit-grade activity log,
soft-delete undo window, atomic temp-file writes.
