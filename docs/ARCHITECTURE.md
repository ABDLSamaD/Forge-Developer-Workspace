# Architecture

Forge is a local-first Electron desktop application. All data lives on the
user's machine; there are no accounts, no network calls, no telemetry.

## Process model

```
┌──────────────────────────────────────────────────────────┐
│  Renderer (sandboxed, untrusted)                         │
│  Vanilla JS UI — renderer/js/*                           │
│  window.forge = small contextBridge API (preload.js)     │
└───────────────┬──────────────────────────────────────────┘
                │ ipcRenderer.invoke("channel", payload)
┌───────────────▼──────────────────────────────────────────┐
│  Preload (contextBridge, contextIsolation: true)         │
│  Fixed channel list only — no arbitrary IPC exposure     │
└───────────────┬──────────────────────────────────────────┘
┌───────────────▼──────────────────────────────────────────┐
│  Main process (trusted)                                  │
│                                                          │
│  main.js      window, session hardening, lifecycle       │
│  ipc.js       channel registration + error containment   │
│  store.js     business rules, validation, activity log,  │
│               soft-delete undo window                    │
│  db.js        SQLite connection, migrations, statements  │
│  backup.js    auto/manual snapshots, restore, retention  │
└───────────────┬──────────────────────────────────────────┘
                │ better-sqlite3 (WAL)
        ┌───────▼────────┐
        │    forge.db    │   userData/forge.db
        └────────────────┘   userData/backups/*.db
```

Key invariant: **the renderer never touches Node APIs, the filesystem, or the
database.** It can only call the ~20 functions exposed by the preload bridge,
each of which maps to a fixed, validated IPC channel.

## Data flow (example: user edits a task)

```
UI form submit
  → forge.updateTask(id, patch)          (renderer)
  → invoke("task:update")                (preload)
  → ipcMain.handle validation            (ipc.js wraps errors)
  → store.updateTask(id, patch)
      · sanitizes every field            (enum whitelists, length caps)
      · diffs against previous values    (activity log entries)
      · updates in-memory read model
      · UPDATE tasks SET ... WHERE id=?  (prepared statement, immediate)
  → { ok, state, rev } returned
  → "state:changed" push to renderer     (fresh state, rev for dedupe)
  → UI re-renders from pushed state
```

The in-memory `state` object is a read model that mirrors the database. Every
mutation writes through to SQLite synchronously before the response returns,
so a crash can lose at most the operation in flight — nothing more.

## Module responsibilities

| File | Owns |
| --- | --- |
| `main.js` | BrowserWindow creation, sandbox flags, popup/navigation policy, single-instance lock, quit sequencing |
| `preload.js` | The complete security boundary. Exposes named functions only |
| `ipc.js` | Channel registry; converts thrown errors into `{ ok:false }` responses so renderer never sees stack traces |
| `store.js` | Sanitization, business invariants, activity audit trail, undo window, JSON export/import dialogs |
| `db.js` | Connection lifecycle, WAL tuning, versioned migrations, prepared statements, transactions |
| `backup.js` | Daily snapshots with retention, manual backup dialog, validated restore + relaunch |

## Ordering model

List order matters to the UI (newest first, duplicates sit below their source,
undo restores at the original slot). This order is persisted via an integer
`position` column:

- create → `MIN(position) - 1`
- duplicate → shift everything after source right by 1, insert at `src + 1` (single transaction)
- undo-delete → shift everything from the restored index right by 1, insert there (single transaction)

No floating-point gaps, no periodic renumbering.

## Concurrency & durability

- Single connection, opened once per app run.
- WAL journal + `synchronous = NORMAL`: fast commits, crash-safe.
- Multi-row changes (duplicate, undo, project delete, import, reset) run inside
  `IMMEDIATE` transactions.
- `before-quit` closes the connection cleanly (WAL checkpoint), releasing the file.

See [DATABASE.md](DATABASE.md) for schema and migration details and
[SECURITY.md](SECURITY.md) for the threat model.
