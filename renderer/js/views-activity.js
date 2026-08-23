"use strict";

/* Activity: audit-style timeline with filters. */

(() => {
  const { h } = App;

  App.ACTION_META = {
    created: { label: "Created", glyph: "+" },
    updated: { label: "Updated", glyph: "~" },
    "status-changed": { label: "Status changed", glyph: "\u2192" },
    "priority-changed": { label: "Priority changed", glyph: "!" },
    "project-changed": { label: "Project changed", glyph: "\u2317" },
    completed: { label: "Completed", glyph: "\u2713" },
    reopened: { label: "Reopened", glyph: "\u25cb" },
    deleted: { label: "Deleted", glyph: "\u00d7" },
    restored: { label: "Restored", glyph: "\u21ba" },
    archived: { label: "Archived", glyph: "\u25a4" },
    unarchived: { label: "Unarchived", glyph: "\u21ba" },
    pinned: { label: "Pinned", glyph: "*" },
    unpinned: { label: "Unpinned", glyph: "\u00b7" },
    migrated: { label: "Migrated", glyph: "\u21c4" },
    reset: { label: "Workspace reset", glyph: "\u26a1" },
    cleared: { label: "Cleared", glyph: "\u2212" },
  };
  App.ACTION_GLYPHS = Object.fromEntries(
    Object.entries(App.ACTION_META).map(([k, v]) => [k, v.glyph])
  );

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
  }

  App.views.activity = {
    render(container) {
      const ui = App.ui.activity;

      const entitySel = h("select", {
        class: "select sm",
        onchange: () => { ui.entity = entitySel.value; renderFeed(); },
      },
        h("option", { value: "all" }, "All entities"),
        h("option", { value: "task", selected: ui.entity === "task" }, "Work items"),
        h("option", { value: "project", selected: ui.entity === "project" }, "Projects"),
        h("option", { value: "system", selected: ui.entity === "system" }, "System")
      );
      entitySel.value = ["all", "task", "project", "system"].includes(ui.entity) ? ui.entity : "all";

      const actionSel = h("select", {
        class: "select sm",
        onchange: () => { ui.action = actionSel.value; renderFeed(); },
      },
        h("option", { value: "all" }, "All actions"),
        Object.entries(App.ACTION_META).map(([val, meta]) =>
          h("option", { value: val, selected: ui.action === val }, meta.label))
      );
      actionSel.value = [...actionSel.options].some((o) => o.value === ui.action) ? ui.action : "all";

      container.append(
        h("div", { class: "page-header" },
          h("div", null,
            h("h1", { class: "page-title" }, "Activity"),
            h("p", { class: "page-subtitle" }, "Complete audit trail of everything that happened in your workspace")
          ),
          h("div", { class: "page-actions" },
            h("button", {
              class: "btn danger-ghost",
              html: `${App.icon("trash", 14)} <span>Clear log</span>`,
              onclick: () => App.workflows.clearActivityLog(),
            })
          )
        ),
        h("div", { class: "toolbar" },
          h("div", { class: "filter-row" }, entitySel, actionSel)
        )
      );

      const feed = h("div", { class: "activity-feed" });
      container.append(feed);

      function renderFeed() {
        App.clear(feed);
        let entries = App.state.activity;

        if (ui.entity !== "all") entries = entries.filter((a) => a.entity === ui.entity);
        if (ui.action !== "all") entries = entries.filter((a) => a.action === ui.action);

        if (!entries.length) {
          feed.append(App.emptyState(
            "activity",
            "No activity recorded yet",
            "Create, edit or complete work and every change will be tracked here."
          ));
          return;
        }

        // group by day
        const groups = [];
        let currentDay = null;
        for (const entry of entries) {
          const label = dayLabel(entry.at);
          if (!currentDay || currentDay.label !== label) {
            currentDay = { label, items: [] };
            groups.push(currentDay);
          }
          currentDay.items.push(entry);
        }

        for (const group of groups) {
          feed.append(h("div", { class: "act-day-label" }, group.label));
          for (const entry of group.items) {
            feed.append(entryRow(entry));
          }
        }
      }

      renderFeed();
    },
  };

  function entryRow(entry) {
    const meta = App.ACTION_META[entry.action] || { label: entry.action, glyph: "\u2022" };

    let targetEl;
    if (entry.entityId && entry.entity === "task" && App.taskById(entry.entityId)) {
      targetEl = h("a", {
        class: "act-target link",
        href: "#",
        onclick: (e) => {
          e.preventDefault();
          App.detail.open(entry.entityId);
        },
      }, truncate(entry.title, 60));
    } else {
      targetEl = h("span", null, truncate(entry.title, 60) || "");
    }

    return h("div", { class: "act-entry" },
      h("span", { class: `act-icon a-${entry.action}` }, meta.glyph),
      h("div", { class: "act-content" },
        h("div", { class: "act-line" },
          h("b", null, meta.label),
          " ",
          targetEl,
          entry.details && h("div", { class: "act-details" }, entry.details)
        )
      ),
      h("span", { class: "act-time" },
        new Date(entry.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))
    );
  }

  function truncate(text, n = 60) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }
})();
