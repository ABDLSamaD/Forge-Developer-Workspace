"use strict";

/* Settings: preferences, data management, shortcuts, about. */

(() => {
  const { h } = App;

  App.views.settings = {
    async render(container) {
      container.append(
        h("div", { class: "page-header" },
          h("div", null,
            h("h1", { class: "page-title" }, "Settings"),
            h("p", { class: "page-subtitle" }, "Preferences and data management for your workspace")
          )
        )
      );

      const info = await forge.getInfo();
      const infoData = info && info.ok ? info.info : null;

      /* ------------------------- preferences ------------------------- */
      const confirmToggle = h("input", {
        type: "checkbox",
        class: "switch",
        checked: Boolean(App.state.settings.confirmDelete),
        onchange: async () => {
          await forge.updateSettings({ confirmDelete: confirmToggle.checked });
          App.state.settings.confirmDelete = confirmToggle.checked;
          App.toast.show({
            msg: confirmToggle.checked ? "Delete confirmation enabled" : "Delete confirmation disabled \u2014 undo toast still available",
          });
        },
      });

      container.append(
        h("section", { class: "widget" },
          h("h3", { class: "widget-title standalone" }, "Preferences"),
          h("label", { class: "pref-row" },
            h("div", null,
              h("b", null, "Confirm before deleting"),
              h("p", { class: "muted small-note" },
                "Show a confirmation dialog when deleting work items. A 5-second undo is always available either way.")
            ),
            confirmToggle
          )
        )
      );

      /* ---------------------------- guide --------------------------- */
      container.append(
        h("section", { class: "widget" },
          h("h3", { class: "widget-title standalone" }, "How Forge Works"),
          h("p", { class: "muted small-note" },
            "Use this workspace in a straight line: project, task, commit, session, then review activity and analytics."),
          h("div", { class: "guide-grid" },
            guideBtn("Projects", "projects", "Open project list and add root paths, repo URLs, and work groups."),
            guideBtn("My Work", "work", "See active work and recent completed items."),
            guideBtn("Dashboard", "dashboard", "Jump to a command-center overview."),
            guideBtn("Activity", "activity", "Review what changed and when.")
          )
        )
      );

      /* --------------------------- data ------------------------------ */
      container.append(
        h("section", { class: "widget" },
          h("h3", { class: "widget-title standalone" }, "Data"),
          h("p", { class: "muted small-note" },
            "Everything is stored locally in a SQLite database (forge.db). JSON export creates a portable file you can import on another computer."),
          infoData && h("p", { class: "muted small-note mono" }, `Storage: ${infoData.userData}`),
          h("div", { class: "btn-row" },
            h("button", {
              class: "btn ghost",
              html: `${App.icon("download", 14)} <span>Export backup</span>`,
              onclick: exportBackup,
            }),
            h("button", {
              class: "btn ghost",
              html: `${App.icon("upload", 14)} <span>Import backup</span>`,
              onclick: importBackup,
            }),
            h("button", {
              class: "btn danger-ghost",
              html: `${App.icon("trash", 14)} <span>Reset workspace</span>`,
              onclick: resetWorkspace,
            })
          )
        )
      );

      /* ---------------------- database & backups --------------------- */
      container.append(buildBackupsWidget(infoData));

      /* ------------------------- shortcuts --------------------------- */
      container.append(
        h("section", { class: "widget" },
          h("h3", { class: "widget-title standalone" }, "Keyboard Shortcuts"),
          shortcutList()
        )
      );

      /* ---------------------------- about ---------------------------- */
      const version = App.appVersion || (infoData && infoData.appVersion) || "0.0.0";
      container.append(
        h("section", { class: "widget" },
          h("h3", { class: "widget-title standalone" }, "About"),
          h("p", { class: "small-note" },
            h("b", null, "Forge"), ` \u2014 personal developer workspace \u00b7 v${version}`),
          infoData && h("p", { class: "muted small-note" },
            `Electron ${infoData.electron} \u00b7 Node ${infoData.node} \u00b7 ${infoData.platform}`)
        )
      );
    },
  };

  async function exportBackup() {
    const result = await forge.exportData();
    if (result && result.ok && !result.canceled) {
      App.toast.show({ msg: "Backup exported", kind: "success" });
    }
  }

  /* ------------- database backups (.db snapshots) ------------------ */

  function buildBackupsWidget(infoData) {
    const b = infoData && infoData.backups;
    const fmt = (ts) =>
      ts ? new Date(ts).toLocaleString() : "not yet (runs daily)";

    return h("section", { class: "widget" },
      h("h3", { class: "widget-title standalone" }, "Database Backups"),
      h("p", { class: "muted small-note" },
        "Forge snapshots its database automatically once a day and keeps the last 10. Snapshots live outside the database file, so a corrupted write never destroys them."),
      b && h("p", { class: "muted small-note mono" }, `Database: ${b.databasePath}`),
      b && h("p", { class: "muted small-note" },
        `Last automatic backup: ${fmt(b.lastAutoBackup)} \u00b7 ${b.autoBackupCount} snapshot(s) kept`),
      h("div", { class: "btn-row" },
        h("button", {
          class: "btn ghost",
          html: `${App.icon("copy", 14)} <span>Save backup now\u2026</span>`,
          onclick: saveDbBackup,
        }),
        h("button", {
          class: "btn ghost",
          html: `${App.icon("folder", 14)} <span>Open backups folder</span>`,
          onclick: () => forge.openBackupsFolder(),
        }),
        h("button", {
          class: "btn danger-ghost",
          html: `${App.icon("refresh", 14)} <span>Restore from backup\u2026</span>`,
          onclick: restoreDbBackup,
        })
      )
    );
  }

  async function saveDbBackup() {
    const result = await forge.createBackup();
    if (result && result.ok && !result.canceled) {
      App.toast.show({ msg: "Database backup saved", kind: "success" });
    } else if (result && !result.ok) {
      App.toast.show({ msg: result.error || "Backup failed", kind: "error" });
    }
  }

  function restoreDbBackup() {
    App.forms.confirm({
      title: "Restore database from backup?",
      message:
        "Your current workspace will be REPLACED by the selected database snapshot. Forge will restart to complete the restore.",
      confirmLabel: "Choose backup & restart",
      danger: true,
      onConfirm: async () => {
        const result = await forge.restoreBackup();
        if (result && result.ok && result.restoring) {
          App.toast.show({ msg: `Restoring ${result.tasks} work item(s)\u2026 restarting` });
        } else if (result && !result.ok) {
          App.toast.show({ msg: result.error || "Restore failed", kind: "error" });
        }
      },
    });
  }

  function importBackup() {
    App.forms.confirm({
      title: "Import backup?",
      message: "Your current workspace will be REPLACED by the contents of the backup file you pick.",
      confirmLabel: "Choose file & replace",
      danger: false,
      onConfirm: async () => {
        const result = await forge.importData();
        if (result && result.ok && !result.canceled && App.applyResult(result)) {
          App.toast.show({ msg: "Workspace imported", kind: "success" });
          App.navigate("dashboard");
        }
      },
    });
  }

  function resetWorkspace() {
    App.forms.confirm({
      title: "Reset entire workspace?",
      message: "All projects, work items and history will be permanently erased. Export a backup first if in doubt.",
      confirmLabel: "Erase everything",
      onConfirm: async () => {
        const result = await forge.resetAll();
        if (App.applyResult(result)) {
          App.toast.show({ msg: "Workspace has been reset" });
          App.navigate("dashboard");
        }
      },
    });
  }

  function shortcutList() {
    const rows = [
      ["Ctrl/Cmd + K", "Open command palette"],
      ["N", "New work item"],
      ["Q", "Quick capture"],
      ["P", "New project"],
      ["/", "Focus search (My Work)"],
      ["1 \u2013 8", "Navigate sections"],
      ["Esc", "Close dialogs / drawer"],
    ];
    return h("ul", { class: "shortcut-list" },
      rows.map(([keys, desc]) =>
        h("li", null,
          h("kbd", null, keys),
          h("span", null, desc)
        ))
    );
  }

  function guideBtn(label, view, text) {
    return h("button", {
      class: "guide-card",
      type: "button",
      onclick: () => App.navigate(view),
    },
      h("strong", null, label),
      h("span", { class: "muted small" }, text)
    );
  }
})();
