# Forge — Personal Developer Workspace

A fast, local-first desktop workspace for a professional software engineer:
personal dashboard + work-item management + projects + schedule + audit-grade
activity history + productivity insights, built with Electron.js.
No frameworks, no remote content, no accounts — your data never leaves the machine.

Forge stores everything in a local **SQLite database** with automatic daily
backups. Data from older JSON versions migrates automatically on first launch.

## Feature map

| Area | What you get |
| --- | --- |
| Dashboard | KPI row (active / in-progress / overdue / done today), quick-capture bar, Focus Today, Upcoming Deadlines, Overdue, Blocked, Recently Updated, Projects with progress bars, productivity analytics |
| My Work | All active items: live search, 6 filters (status, priority, project, type, due date, tag), 6 sort modes, pinned section, inline status changes, hover edit/delete |
| Projects | Create/edit/delete projects with color, status, priority, dates, tags; per-project detail with progress, active/overdue/upcoming/completed and recent activity |
| Schedule | Month calendar of due dates, drag-and-drop rescheduling, click a day to plan work, summary chips deep-link into filtered My Work |
| Activity | Full audit timeline grouped by day; every change records previous -> new values |
| Completed | Historical record of finished work with reopen |
| Archive | Old work stays available but out of dashboards and calendar |
| Settings | Delete-confirmation preference, SQLite database backups (auto + manual + restore), portable JSON export/import, workspace reset, shortcut reference |

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Process model, IPC boundary, module map, data flow |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, migrations, JSON importer, backup/restore strategy |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and hardening checklist |

## Work item model

Title, description, status workflow (Backlog / Planned / In Progress / Blocked /
Review / Testing / Completed / Cancelled), priority (Critical / High / Medium /
Low), type (Feature, Bug, Improvement, Research, Refactor, Docs, Testing,
Deploy, Maintenance, Meeting, Personal, Other), project, tags, effort estimate
(S/M/L), start date, due date, completion date, technical notes, pinning.

## Quick task flow

Forge is optimized for capturing work in seconds.

Primary fields in the task form:

- Title
- Project
- Priority
- Due date

Advanced fields remain behind the "More options" toggle:

- Status
- Type
- Description
- Tags
- Start date
- Estimate
- Notes

## Editing

- Edit button in the hover actions of every card
- Detail drawer (click any item): Edit, status select, Done/Reopen, Duplicate,
  Pin, Archive/Unarchive, Delete
- All fields editable through the validated item form; every change persists
  immediately and is recorded in Activity with before/after values

## Deletion & undo

Deleting is reversible for ~5 seconds via the toast Undo action (backed by a
main-process soft-delete window); afterwards removal is permanent. Undo restores
the item at its original position with all metadata intact.

## Command palette & shortcuts

Ctrl/Cmd+K opens the palette: commands plus live search across work items and
projects.

| Keys | Action |
| --- | --- |
| Ctrl/Cmd + K | Command palette |
| N | New work item |
| Q | Quick capture |
| P | New project |
| / | Focus search (My Work), or palette elsewhere |
| 1-8 | Navigate sections |
| Esc | Close drawer/modal/palette |

## Project structure

```
electron-todo-app/
├── main.js              Main process: window + security hardening
├── ipc.js               IPC channel registration
├── store.js             Business rules, validation, audit log, soft-delete
│                        undo window; mirrors every mutation into SQLite
├── db.js                SQLite connection, WAL tuning, migrations,
│                        prepared statements, transactions
├── backup.js            Daily snapshots with retention, manual backup,
│                        validated restore + relaunch
├── preload.js           contextBridge API (forge.*)
├── scripts/
│   └── db-smoke.test.js Integration tests (npm test)
└── renderer/
    ├── index.html       Shell: sidebar root + overlay roots, strict CSP
    ├── styles.css       Design system
    └── js/
        ├── util.js      DOM builder, icons, constants, query utils
        ├── toast.js     Toast notifications (+ deletion undo toast)
        ├── modal.js     Modal host
        ├── forms.js     Work-item form, project form, quick capture
        ├── detail.js    Detail drawer + shared task card renderer
        ├── workflows.js Delete+undo, project delete, log clearing
        ├── views-*.js   dashboard / work / projects / calendar /
        │                activity / settings pages
        ├── palette.js   Command palette
        └── app.js       Shell, router, shortcuts, boot
```

## Requirements

- Node.js 18 or newer (for development only — end users install nothing)
- npm (bundled with Node)

## Run in development

```
cd electron-todo-app
npm install        # postinstall swaps in the Electron-ABI sqlite binary
npm start          # launches Forge against your real workspace
npm test           # integration suite in an isolated temp profile
```

## Install on other computers (packaged builds)

Uses electron-builder. Build on the OS you target:

| Command | Output |
| --- | --- |
| npm run dist:win | Windows NSIS installer .exe + portable exe |
| npm run dist:mac | macOS .dmg (Intel + Apple Silicon) |
| npm run dist:linux | Linux AppImage |
| npm run dist:dir | Unpacked folder (quick test) |

Artifacts land in `release/`. First build downloads packaging binaries.

### Distributing

1. Copy the installer from `release/` to the target computer.
2. Windows: run the setup exe (SmartScreen may appear: More info -> Run anyway).
   macOS: open the dmg, drag Forge to Applications (Gatekeeper: right-click ->
   Open on first launch). Linux: chmod +x the AppImage and run it.
3. Each user gets their own local data file; nothing is shared or uploaded.

To sign builds, set `CSC_LINK` and `CSC_KEY_PASSWORD` before running dist.

## Where data lives

A SQLite database plus automatic snapshots, per OS user:

- Windows: `%APPDATA%\forge-workspace\` → `forge.db`, `backups/`
- macOS: `~/Library/Application Support/forge-workspace/`
- Linux: `~/.config/forge-workspace/`

Legacy `forge-data.json` / `todos.json` are migrated once on first launch and
then left untouched as history. See [docs/DATABASE.md](docs/DATABASE.md).

Backups:

- **Automatic**: daily snapshot, newest 10 kept (`backups/forge-auto-*.db`)
- **Manual**: Settings → Database Backups → Save backup now…
- **Restore**: Settings → Database Backups → Restore from backup… (app relaunches)
- **Portable export**: JSON via Settings → Data → Export backup

## Security model

- Sandboxed renderer (`app.enableSandbox()`, `sandbox: true`)
- Context isolation + contextBridge; only a small typed `window.forge` API exposed
- Strict CSP: `default-src 'none'`; no inline scripts; local assets only
- Navigation restricted to the bundled renderer directory; popups blocked;
  external links go to the system browser
- Every IPC payload sanitized in the main process (enum whitelists, length caps,
  ISO-date validation, tag normalization)
- All web permissions denied; DevTools disabled in packaged builds
- Single-instance lock
- SQL access exclusively via prepared statements in the main process; foreign
  keys enforced; no shell command execution anywhere

Full checklist: [docs/SECURITY.md](docs/SECURITY.md).

## License

MIT
