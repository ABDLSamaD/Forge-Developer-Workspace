# Security Model

Forge treats the renderer as an untrusted surface. The full checklist below is
verified against the current code (v3.1.0).

## Electron hardening

| Control | Status |
| --- | --- |
| `contextIsolation: true` | main.js |
| `nodeIntegration: false` | main.js |
| `sandbox: true` + `app.enableSandbox()` | main.js |
| `webviewTag: false` | main.js |
| DevTools disabled in packaged builds | `devTools: !app.isPackaged` |
| Single-instance lock | prevents multi-process DB contention |
| All web permissions denied (request + check handlers) | main.js |

## Content security

- Strict CSP in `renderer/index.html`:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'`
  No remote origins, no inline scripts, no `unsafe-eval`.
- **Popups blocked**: every `window.open` denied; http(s) URLs go to the system
  browser via `shell.openExternal`.
- **Navigation locked to the bundle**: `will-navigate` allows only `file://`
  URLs inside the app's own renderer directory (defense-in-depth handler is
  attached on `web-contents-created`, so it covers any future window).
- Renderer builds DOM via a typed helper (`h()`) that uses
  `textContent`/attributes; the single `innerHTML` escape hatch is used only
  for constant SVG icon markup, never user data.

## IPC boundary

- Preload exposes ~20 named functions via `contextBridge`. It never exposes
  `ipcRenderer` itself and accepts no channel names from the renderer.
- Every channel handler validates inputs in the main process:
  - strings length-capped and control-character stripped
  - enums checked against whitelists (status, priority, type, effort…)
  - dates must match ISO `yyyy-mm-dd`; timestamps must be positive numbers
  - IDs must be short strings; unknown project references are dropped
- Handler wrapper catches everything thrown and returns
  `{ ok: false, error: "Internal error" }` — stack traces and file paths never
  reach the renderer.

## Database & filesystem

- SQLite accessed exclusively in the main process through `db.js`.
- 100% prepared statements / bound parameters — SQL injection structurally
  impossible.
- Foreign keys enforced; orphan references rejected at the engine level.
- Filesystem writes limited to: the userData directory (database, backups) and
  explicit user-chosen paths from native save/open dialogs. No path comes from
  renderer input.

## Process execution

Forge executes **no shell commands**. There is no `child_process` usage, no
`exec()`, no string-concatenated command lines — nothing for shell injection
to attach to.

## Secrets

- No credentials, tokens, or secrets are stored, logged, or transmitted.
- The app performs zero network requests by design.
- Future work involving API tokens must use the OS credential store
  (Windows Credential Manager / macOS Keychain), not database columns.

## Error handling & logging

- Errors surface as structured `{ ok, error }` results or console output in
  the main process only.
- Logs contain operation metadata, never user content beyond titles already
  visible in the UI, and never secret material.

## Dependency posture

- Runtime dependency: `better-sqlite3` (with small transitive helpers
  `bindings` + `prebuild-install`).
- Native module uses prebuilt binaries — no build tools required on dev or
  end-user machines; `postinstall` swaps in the Electron-ABI binary.
- Run `npm audit` before releases; keep Electron updated for Chromium
  security patches.
