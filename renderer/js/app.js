"use strict";

/* App shell: sidebar navigation, router, keyboard shortcuts, boot. */

(() => {
  const { h } = App;

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "work", label: "My Work", icon: "work" },
    { id: "projects", label: "Projects", icon: "projects" },
    { id: "calendar", label: "Schedule", icon: "calendar" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "completed", label: "Completed", icon: "completed" },
    { id: "archive", label: "Archive", icon: "archive" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  let currentView = "dashboard";
  let viewContainer;
  let versionEl;

  function defaultUiState() {
    return {
      work: { query: "", status: "all", priority: "all", project: "all", type: "all", due: "all", tag: "all", sort: "due" },
      completed: { query: "", status: "completed", priority: "all", project: "all", type: "all", due: "all", tag: "all", sort: "newest" },
      archive: { query: "", sort: "updated" },
      activity: { entity: "all", action: "all" },
      projects: { openId: null },
      calendar: { month: App.todayStr().slice(0, 7) },
      settings: {},
    };
  }
  Object.assign(App.ui, defaultUiState());

  /* ------------------------------ shell ------------------------------ */

  function buildShell() {
    const brand = h("div", { class: "brand" },
      h("span", { class: "brand-mark", html: App.icon("zap", 15) }),
      h("span", { class: "brand-name" }, "Forge"),
      h("span", { class: "brand-sub" }, "Developer Workspace")
    );

    const navItems = NAV.map((item, index) =>
      h("button", {
        class: "nav-item",
        dataset: { view: item.id },
        title: `${item.label} (${index + 1})`,
        onclick: () => navigate(item.id),
      },
        h("span", { class: "nav-icon", html: App.icon(item.icon, 16) }),
        h("span", { class: "nav-label" }, item.label),
        h("kbd", { class: "nav-hint" }, String(index + 1))
      )
    );

    const paletteBtn = h("button", {
      class: "palette-trigger",
      title: "Command Palette (Ctrl+K)",
      onclick: () => App.palette.toggle(),
    },
      h("span", { style: { display: "inline-flex" }, html: App.icon("search", 13) }),
      h("span", { class: "nav-label" }, "Search or run a command"),
      h("kbd", null, "\u2318K")
    );

    const sidebar = h("aside", { class: "sidebar" },
      brand,
      paletteBtn,
      h("nav", { class: "nav" }, navItems),
      h("div", { class: "sidebar-footer" },
        versionEl = h("span", { class: "muted tiny" }, "Local-first")
      )
    );

    viewContainer = h("main", { id: "view", class: "view-container" });

    document.getElementById("app-root").append(sidebar, h("div", { class: "main-area" }, viewContainer));
  }

  /* ----------------------------- routing ----------------------------- */

  async function navigate(viewId) {
    if (!App.views[viewId]) return;
    currentView = viewId;

    document.querySelectorAll(".nav-item").forEach((el) =>
      el.classList.toggle("active", el.dataset.view === viewId));

    forge.updateSettings({ lastView: viewId }).then(() => {}, () => {});
    App.state.settings.lastView = viewId;

    render();
    viewContainer.scrollTop = 0; // fresh page starts at the top
  }

  App.navigate = navigate;
  App.currentView = () => currentView;

  function render(closeDrawer = true) {
    if (closeDrawer && App.detail && App.detail.isOpen()) App.detail.close();
    // Data refreshes must keep the user's place in the list, not jump to the top.
    const keepScroll = viewContainer.scrollTop;
    App.clear(viewContainer);
    App.views[currentView].render(viewContainer);
    viewContainer.scrollTop = keepScroll;
  }

  App.refreshView = () => {
    render(false); // keep the detail drawer open across data updates
    if (App.onDataChanged) App.onDataChanged();
  };

  /* --------------------------- shortcuts ------------------------------ */

  function isTyping() {
    const el = document.activeElement;
    return el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      App.palette.toggle();
      return;
    }
    if (isTyping() || App.modal.isOpen() || App.palette.isOpen()) return;

    switch (e.key) {
      case "n": case "N":
        e.preventDefault();
        App.forms.openTaskForm({ initial: {} });
        break;
      case "q": case "Q":
        e.preventDefault();
        App.forms.openQuickCapture();
        break;
      case "p": case "P":
        e.preventDefault();
        App.forms.openProjectForm();
        break;
      case "/": {
        e.preventDefault();
        if (currentView === "work" && App.ui.work.searchEl) {
          App.ui.work.searchEl.focus();
        } else {
          App.palette.open();
        }
        break;
      }
      default:
        if (/^[1-8]$/.test(e.key)) {
          const target = NAV[Number(e.key) - 1];
          if (target) navigate(target.id);
        }
    }
  });

  /* ------------------------------- boot ------------------------------- */

  function renderFatalError(message) {
    App.clear(viewContainer);
    viewContainer.append(
      h("div", { class: "empty-state" },
        h("p", { class: "empty-title" }, "Could not load workspace"),
        h("p", { class: "empty-hint" }, message || "Unknown error \u2014 try restarting the app.")
      )
    );
  }

  async function boot() {
    try {
      buildShell();

      viewContainer.append(
        h("div", { class: "boot-loading" },
          h("div", { class: "spinner" }),
          h("p", { class: "muted" }, "Loading your workspace...")
        )
      );

      const result = await forge.getState();
      if (!result || !result.ok) {
        renderFatalError((result && result.error) || "Unknown error \u2014 try restarting the app.");
        return;
      }

      App.state = result.state;
      if (result.appVersion) {
        App.appVersion = result.appVersion;
        versionEl.textContent = `Local-first \u00b7 v${App.appVersion}`;
      }

      // Push sync: the main process is the single source of truth. Whenever a
      // mutation happens anywhere, fresh state arrives here and re-renders.
      forge.onStateChanged(({ state, rev }) => {
        if (rev != null && rev === App._stateRev) return; // already applied via response
        App._stateRev = rev;
        App.state = state;
        App.refreshView();
      });

      // restore last view if valid
      const savedView = App.state.settings.lastView;
      await navigate(NAV.some((n) => n.id === savedView) ? savedView : "dashboard");
    } catch (err) {
      console.error("Boot failed:", err);
      if (viewContainer) renderFatalError(String(err && err.message ? err.message : err));
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
