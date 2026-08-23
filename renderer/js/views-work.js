"use strict";

/* Shared list machinery + My Work, Completed and Archive pages. */

(() => {
  const { h } = App;

  /* ------------------------- filter toolbar ------------------------ */

  function buildToolbar(viewId, config, rerender) {
    const ui = App.ui[viewId];

    const search = h("input", {
      class: "search-input",
      type: "search",
      placeholder: "Search title, notes, project, tags...  ( / )",
      value: ui.query,
      oninput: App.debounce(() => {
        ui.query = search.value.trim();
        rerender();
      }, 140),
    });

    const mkSelect = (key, options, allLabel) =>
      h("select", {
        class: "select sm",
        title: allLabel,
        onchange: () => {
          ui[key] = selectRefs[key].value;
          rerender();
        },
      },
        h("option", { value: "all" }, allLabel),
        options.map(([val, label]) => h("option", { value: val, selected: ui[key] === val }, label))
      );

    const selectRefs = {};
    const selects = [];

    const addSelect = (key, el) => {
      selectRefs[key] = el;
      selects.push(el);
    };

    for (const cfg of config.selects) {
      if (cfg.key === "status") addSelect("status", mkSelect("status", cfg.options || App.STATUSES, "All statuses"));
      else if (cfg.key === "priority") addSelect("priority", mkSelect("priority", App.PRIORITIES, "Any priority"));
      else if (cfg.key === "project")
        addSelect(
          "project",
          (() => {
            const el = mkSelect("project", [], "All projects");
            // dynamic options
            return el;
          })()
        );
      else if (cfg.key === "type") addSelect("type", mkSelect("type", App.TYPES, "All types"));
      else if (cfg.key === "due") addSelect("due", mkSelect("due", [["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["none", "No due date"]], "Any due date"));
      else if (cfg.key === "tag") {
        const el = mkSelect("tag", [], "All tags");
        addSelect("tag", el);
      }
    }

    // populate dynamic option lists
    if (selectRefs.project) {
      App.clear(selectRefs.project);
      selectRefs.project.append(
        h("option", { value: "all" }, "All projects"),
        ...App.state.projects.map((p) => h("option", { value: p.id, selected: ui.project === p.id }, p.name))
      );
      selectRefs.project.value = selectRefs.project.querySelector(`option[value="${CSS.escape(ui.project)}"]`)
        ? ui.project
        : "all";
    }
    if (selectRefs.tag) {
      App.clear(selectRefs.tag);
      selectRefs.tag.append(
        h("option", { value: "all" }, "All tags"),
        ...App.allTags().map((t) => h("option", { value: t, selected: ui.tag === t }, t))
      );
      selectRefs.tag.value = selectRefs.tag.querySelector(`option[value="${CSS.escape(ui.tag)}"]`) ? ui.tag : "all";
    }
    // restore values for static selects
    for (const [key, el] of Object.entries(selectRefs)) {
      if (key === "project" || key === "tag") continue;
      const wanted = String(ui[key]);
      el.value = el.querySelector(`option[value="${CSS.escape(wanted)}"]`) ? ui[key] : "all";
    }

    const sortSel = config.sorts
      ? h("select", {
          class: "select sm",
          title: "Sort",
          onchange: () => {
            ui.sort = sortSel.value;
            rerender();
          },
        },
          config.sorts.map(([val, label]) => h("option", { value: val, selected: ui.sort === val }, label))
        )
      : null;
    if (sortSel && !config.sorts.some(([v]) => v === ui.sort)) {
      ui.sort = config.sorts[0][0];
      sortSel.value = ui.sort;
    }

    const toolbar = h("div", { class: "toolbar" },
      h("div", { class: "search-box" }, App.h("span", { class: "search-icon", html: App.icon("search", 14) }), search),
      h("div", { class: "filter-row" }, selects, sortSel)
    );

    return { toolbar, search };
  }

  function applyFilters(tasks, viewId, opts = {}) {
    const ui = App.ui[viewId];
    let list = tasks.filter((t) => App.matchQuery(t, ui.query));

    if (ui.status && ui.status !== "all") list = list.filter((t) => t.status === ui.status);
    if (ui.priority && ui.priority !== "all") list = list.filter((t) => t.priority === ui.priority);
    if (ui.type && ui.type !== "all") list = list.filter((t) => t.type === ui.type);
    if (ui.project && ui.project !== "all") list = list.filter((t) => t.projectId === ui.project);
    if (ui.tag && ui.tag !== "all") list = list.filter((t) => t.tags.includes(ui.tag));
    if (ui.due && ui.due !== "all") {
      const today = App.todayStr();
      list = list.filter((t) => {
        if (ui.due === "overdue") return App.isOverdue(t);
        if (ui.due === "today") return t.dueDate === today;
        if (ui.due === "week") return t.dueDate && t.dueDate >= today && t.dueDate <= App.addDays(today, 7);
        if (ui.due === "none") return !t.dueDate;
        return true;
      });
    }
    if (!opts.skipPinnedFirst) return App.sortTasks(list, ui.sort);
    return App.sortTasks(list, ui.sort);
  }

  /* ---------------------------- pages ------------------------------ */

  App.views.work = {
    render(container) {
      const ui = App.ui.work;
      const header = pageHeader("My Work", `${App.activeTasks().length} active item(s)`);

      const newBtn = h("button", {
        class: "btn primary",
        html: `${App.icon("plus", 14)} <span>New Work Item</span>`,
        onclick: () => App.forms.openTaskForm({ initial: {} }),
      });
      const quickBtn = h("button", {
        class: "btn ghost",
        html: `${App.icon("zap", 14)} <span>Quick Capture</span>`,
        onclick: () => App.forms.openQuickCapture(),
      });

      const listBox = h("div", { class: "list-stack" });
      const countLine = h("div", { class: "muted count-line" });

      const { toolbar, search } = buildToolbar(
        "work",
        {
          selects: [
            { key: "status" },
            { key: "priority" },
            { key: "project" },
            { key: "type" },
            { key: "due" },
            { key: "tag" },
          ],
          sorts: [
            ["due", "Due date"],
            ["priority", "Priority"],
            ["updated", "Recently updated"],
            ["newest", "Newest"],
            ["oldest", "Oldest"],
            ["alpha", "A \u2192 Z"],
          ],
        },
        () => renderInto(listBox, countLine, "work", { pinnedFirst: true })
      );

      ui.searchEl = search; // focused via "/" shortcut

      container.append(header,
        h("div", { class: "page-actions" }, quickBtn, newBtn),
        toolbar
      );

      container.append(countLine, listBox);
      renderInto(listBox, countLine, "work", { pinnedFirst: true });
    },
  };

  function renderInto(box, countLine, viewId, opts = {}) {
    App.clear(box);
    const ui = App.ui[viewId];
    const source =
      viewId === "completed"
        ? App.state.tasks.filter((t) => t.status === "completed")
        : viewId === "archive"
          ? App.state.tasks.filter((t) => t.archived)
          : App.activeTasks();

    const items = applyFilters(source, viewId, opts);
    countLine.textContent = `${items.length} item(s)`;

    if (items.length === 0) {
      box.append(emptyStateFor(viewId));
      return;
    }

    if (opts.pinnedFirst) {
      const pinned = items.filter((t) => t.pinned);
      const rest = items.filter((t) => !t.pinned);
      if (pinned.length && ui.query === "" && isDefaultFilters(viewId)) {
        box.append(h("div", { class: "group-label" }, "Pinned"));
        pinned.forEach((t) => box.append(App.buildTaskCard(t)));
        box.append(h("div", { class: "group-label" }, "Everything else"));
      }
      rest.forEach((t) => box.append(App.buildTaskCard(t)));
    } else {
      items.forEach((t) =>
        box.append(App.buildTaskCard(t, {
          showCompletedAt: viewId === "completed",
          showType: true,
        }))
      );
    }
  }

  function isDefaultFilters(viewId) {
    const ui = App.ui[viewId];
    return (
      ui.status === "all" && ui.priority === "all" && ui.project === "all" &&
      ui.type === "all" && ui.due === "all" && ui.tag === "all"
    );
  }

  function emptyStateFor(viewId) {
    if (viewId === "completed") {
      return emptyState("completed", "Nothing completed yet", "Finished work will collect here so you can look back on progress.");
    }
    if (viewId === "archive") {
      return emptyState("archive", "Archive is empty", "Archived items stay out of your way but remain searchable.");
    }
    const filtered = !isDefaultFilters("work") || App.ui.work.query;
    if (filtered) {
      return emptyState("search", "No matching work items", "Try adjusting filters or clearing the search.");
    }
    return emptyState("inbox", "No active work yet", "Your workspace is clear. Add something you're planning to work on.");
  }

  /* --------------------------- completed --------------------------- */

  App.views.completed = {
    render(container) {
      container.append(pageHeader("Completed", "Shipped, fixed and finished work"));

      const listBox = h("div", { class: "list-stack" });
      const countLine = h("div", { class: "muted count-line" });

      const { toolbar } = buildToolbar(
        "completed",
        {
          selects: [{ key: "project" }, { key: "type" }],
          sorts: [
            ["newest", "Newest"],
            ["updated", "Recently updated"],
            ["alpha", "A \u2192 Z"],
          ],
        },
        () => renderInto(listBox, countLine, "completed")
      );

      container.append(toolbar);
      container.append(countLine, listBox);
      renderInto(listBox, countLine, "completed");
    },
  };

  /* ---------------------------- archive ---------------------------- */

  App.views.archive = {
    render(container) {
      container.append(pageHeader("Archive", "Stored away, still available"));

      const listBox = h("div", { class: "list-stack" });
      const countLine = h("div", { class: "muted count-line" });
      container.append(countLine, listBox);

      App.clear(listBox);
      const items = App.sortTasks(
        App.state.tasks.filter((t) => t.archived).map((t) => ({
          ...t,
        })),
        App.ui.archive.sort || "updated"
      );

      if (items.length === 0) {
        countLine.textContent = "0 item(s)";
        listBox.append(emptyState("archive", "Archive is empty", "Archive a work item from its detail drawer to store it here."));
        return;
      }

      countLine.textContent = `${items.length} item(s)`;
      for (const task of items) {
        const live = App.taskById(task.id);
        if (!live) continue;
        const card = App.buildTaskCard({ ...live }, { showType: false });
        card.querySelector(".item-check")?.remove();
        card.insertAdjacentElement(
          "afterbegin",
          h("button", {
            class: "btn sm ghost",
            html: `${App.icon("undo", 13)} <span>Unarchive</span>`,
            onclick: async (e) => {
              e.stopPropagation();
              if (await App.mutate(forge.updateTask(live.id, { archived: false }))) {
                App.toast.show({ msg: "\u201c" + truncate(live.title) + "\u201d restored to My Work", kind: "success" });
              }
            },
          })
        );
        listBox.append(card);
      }
    },
  };

  /* ---------------------------- shared ----------------------------- */

  function pageHeader(title, subtitle) {
    return h("div", { class: "page-header" },
      h("div", null,
        h("h1", { class: "page-title" }, title),
        subtitle && h("p", { class: "page-subtitle" }, subtitle)
      )
    );
  }
  App.pageHeader = pageHeader;

  function emptyState(iconName, titleText, hint) {
    return h("div", { class: "empty-state" },
      h("div", { class: "empty-icon", html: App.icon(iconName, 26) }),
      h("p", { class: "empty-title" }, titleText),
      h("p", { class: "empty-hint" }, hint)
    );
  }
  App.emptyState = emptyState;

  function truncate(text, n = 44) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }
})();
