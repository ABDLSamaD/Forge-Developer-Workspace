# Forge — Personal Developer Workspace

A fast, local-first desktop workspace for a professional software engineer:
personal dashboard + work-item management + projects + schedule + audit-grade
activity history + productivity insights, built with Electron.js.
No frameworks, no remote content, no accounts — your data never leaves the machine.

Forge is the evolution of an earlier simple todo app; old data migrates
automatically on first launch.

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
| Settings | Delete-confirmation preference, native export/import backups, workspace reset, shortcut reference |

## Work item model

Title, description, status workflow (Backlog / Planned / In Progress / Blocked /
Review / Testing / Completed / Cancelled), priority (Critical / High / Medium /
Low), type (Feature, Bug, Improvement, Research, Refactor, Docs, Testing,
Deploy, Maintenance, Meeting, Personal, Other), project, tags, effort estimate
(S/M/L), start date, due date, completion date, technical notes, pinning.

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
├── store.js             Schema v3, validation, audit log, soft-delete
│                        window, atomic debounced saves
├── preload.js           contextBridge API (forge.*)
└── renderer/
    ├── index.html       Shell: sidebar root + overlay roots
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

- Node.js 18 or newer
- npm (bundled with Node)

## Run in development

```
cd electron-todo-app
npm install
npm start
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

One JSON file per OS user:

- Windows: `%APPDATA%\forge-workspace\forge-data.json`
- macOS: `~/Library/Application Support/forge-workspace/forge-data.json`
- Linux: `~/.config/forge-workspace/forge-data.json`

Use Settings -> Export backup to move data between machines; Import restores it.

## Security model

- Sandboxed renderer (`app.enableSandbox()`, `sandbox: true`)
- Context isolation + contextBridge; only a small typed `window.forge` API exposed
- Strict CSP: `default-src 'none'`; no inline scripts; local assets only
- Every IPC payload sanitized in the main process (enum whitelists, length caps,
  ISO-date validation, tag normalization)
- Popups blocked, navigation away blocked, external links go to system browser
- All web permissions denied; DevTools disabled in packaged builds
- Single-instance lock; atomic temp-file + rename writes prevent corruption

Electron targets desktop platforms (Windows/macOS/Linux). It does not run on
iOS/iPadOS or Android.

## License

MIT
