"use strict";

/* Work item detail drawer: full info, inline actions, per-item history. */

App.detail = (() => {
  const { h } = App;
  let currentId = null;
  let root, panel;

  function ensureDom() {
    if (root) return;
    root = document.getElementById("drawer-root");
    panel = h("aside", { class: "drawer", "aria-label": "Work item details" });
    root.appendChild(panel);
  }

  function isOpen() {
    return currentId !== null;
  }

  function open(id) {
    ensureDom();
    currentId = id;
    render();
    document.addEventListener("keydown", escListener, true);
  }

  function close() {
    if (!root) return;
    currentId = null;
    panel.classList.remove("open");
    document.removeEventListener("keydown", escListener);
  }

  function escListener(e) {
    if (e.key === "Escape") close();
  }

  function refreshIfCurrent() {
    if (currentId && App.taskById(currentId)) render();
  }
  App.onDataChanged = () => {
    if (currentId && !App.taskById(currentId)) close();
    else refreshIfCurrent();
  };

  /* --------------------------- building blocks --------------------- */

  function statusPill(status, onchange) {
    const sel = h("select", { class: "status-pill", title: "Change status", onchange: (e) => onchange(e.target.value) },
      App.STATUSES.map(([val, label]) => h("option", { value: val, selected: val === status }, label))
    );
    sel.classList.add(`s-${status}`);
    sel.addEventListener("click", (e) => e.stopPropagation());
    return sel;
  }

  function prioBadge(priority) {
    return h("span", { class: `prio-badge p-${priority}` }, App.priorityLabel(priority));
  }

  function typeBadge(type) {
    return h("span", { class: `type-badge t-${type}` }, App.typeLabel(type));
  }

  function effortBadge(effort) {
    return h("span", { class: "effort-badge", title: "Estimated effort" }, App.label(App.EFFORTS, effort));
  }

  function detailRow(labelText, valueEl) {
    if (!valueEl || (Array.isArray(valueEl) && valueEl.length === 0)) return null;
    return h("div", { class: "detail-row" },
      h("span", { class: "dt" }, labelText),
      h("div", { class: "dd" }, valueEl)
    );
  }

  function textOrMuted(text, mutedText) {
    return text ? String(text) : h("span", { class: "muted" }, mutedText || "None");
  }

  /* ------------------------------ render --------------------------- */

  function render() {
    const task = App.taskById(currentId);
    if (!task) return close();

    App.clear(panel);

    const project = task.projectId ? App.projectById(task.projectId) : null;
    const history = App.state.activity
      .filter((a) => a.entity === "task" && a.entityId === task.id)
      .slice(0, 30);

    const isDone = ["completed", "cancelled"].includes(task.status);

    /* --- header --- */
    const head = h("div", { class: "drawer-head" },
      h("div", { class: "drawer-head-top" },
        typeBadge(task.type),
        prioBadge(task.priority),
        task.effort && effortBadge(task.effort),
        h("button", {
          class: "icon-btn pin-btn" + (task.pinned ? " active" : ""),
          title: task.pinned ? "Unpin" : "Pin to focus",
          html: App.icon("star", 14),
          onclick: async () => App.mutate(forge.updateTask(task.id, { pinned: !task.pinned })),
        })
      ),
      h("h2", { class: "drawer-title" + (isDone ? " done" : "") }, task.title),
      h("div", { class: "drawer-head-meta" },
        project
          ? h("button", { class: "link-btn", onclick: () => { close(); App.navigate("projects"); } },
              h("span", { class: "proj-dot", style: { background: project.color || "#6c8cff" } }), project.name)
          : h("span", { class: "muted" }, "No project"),
        h("span", { class: "meta-sep" }, "\u00b7"),
        h("span", { class: "muted" }, `Created ${App.relTime(task.createdAt)}`),
        h("span", { class: "meta-sep" }, "\u00b7"),
        h("span", { class: "muted" }, `Updated ${App.relTime(task.updatedAt)}`)
      ),
      h("button", { class: "icon-btn drawer-close", title: "Close", html: App.icon("x", 15), onclick: close })
    );

    /* --- quick status row --- */
    const statusRow = h("div", { class: "drawer-status-row" },
      statusPill(task.status, async (status) => {
        await App.mutate(forge.updateTask(task.id, { status }));
      }),
      !isDone &&
        h("button", {
          class: "btn sm primary",
          html: `${App.icon("check", 13)} <span>Done</span>`,
          onclick: () => completeTask(task),
        }),
      isDone &&
        h("button", {
          class: "btn sm ghost",
          html: `${App.icon("refresh", 13)} <span>Reopen</span>`,
          onclick: () => reopenTask(task),
        })
    );

    /* --- body fields --- */
    let dueValue = null;
    if (task.dueDate) {
      const overdue = App.isOverdue(task);
      const relative = App.dueText(task);
      dueValue = h("span", { class: overdue ? "due-overdue" : "" },
        h("strong", null, App.fmtDate(task.dueDate)),
        relative && relative !== App.fmtDate(task.dueDate) ? ` \u00b7 ${relative}` : ""
      );
    }

    const body = h("div", { class: "drawer-body" },
      detailRow("Description", task.description ? h("p", { class: "pre-wrap desc-text" }, task.description) : null),
      detailRow("Due date", dueValue),
      task.startDate && detailRow("Start date", App.fmtDate(task.startDate)),
      task.completedAt && detailRow("Completed", new Date(task.completedAt).toLocaleString()),
      detailRow("Tags", task.tags.length
        ? h("div", { class: "tag-wrap" }, task.tags.map((t) => h("span", { class: "tag-chip" }, t)))
        : null),
      detailRow("Notes", task.notes ? h("p", { class: "pre-wrap notes-pre" }, task.notes) : null)
    );

    /* --- activity section --- */
    const actSection = h("div", { class: "drawer-activity" },
      h("h3", { class: "section-label" }, "History"),
      history.length === 0
        ? h("p", { class: "muted small-note" }, "No recorded changes yet.")
        : h("ul", { class: "mini-act-list" },
            history.map((a) =>
              h("li", { class: "mini-act" },
                h("span", { class: `act-icon a-${a.action}` }, actionGlyph(a.action)),
                h("div", null,
                  h("div", { class: "act-line" },
                    h("b", null, App.ACTION_META[a.action] ? App.ACTION_META[a.action].label : a.action),
                    a.details && h("span", { class: "act-details" }, ` \u2014 ${a.details}`)
                  ),
                  h("span", { class: "act-time" }, App.relTime(a.at))
                )
              )
            )
          )
    );

    /* --- footer actions --- */
    const foot = h("div", { class: "drawer-footer" },
      h("button", {
        class: "btn sm ghost",
        html: `${App.icon("edit", 13)} <span>Edit</span>`,
        onclick: () => App.forms.openTaskForm({ initial: task }),
      }),
      h("button", {
        class: "btn sm ghost",
        html: `${App.icon("copy", 13)} <span>Duplicate</span>`,
        onclick: async () => {
          if (await App.mutate(forge.duplicateTask(task.id)))
            App.toast.show({ msg: "Work item duplicated", kind: "success" });
        },
      }),
      h("button", {
        class: "btn sm ghost",
        html: `${App.icon("archive", 13)} <span>${task.archived ? "Unarchive" : "Archive"}</span>`,
        onclick: async () => {
          if (await App.mutate(forge.updateTask(task.id, { archived: !task.archived }))) {
            App.toast.show({ msg: task.archived ? "Restored from archive" : "Moved to archive", kind: "success" });
            if (!task.archived) close();
          }
        },
      }),
      h("button", {
        class: "btn sm danger-ghost",
        html: `${App.icon("trash", 13)} <span>Delete</span>`,
        onclick: () => App.workflows.deleteWithUndo(task),
      })
    );

    panel.append(head, statusRow, body, actSection, foot);
    panel.classList.add("open");
  }

  function completeTask(task) {
    App.mutate(forge.updateTask(task.id, { status: "completed" })).then((okRes) => {
      if (okRes) App.toast.show({ msg: `Completed \u201c${truncate(task.title)}\u201d`, kind: "success" });
    });
  }

  function reopenTask(task) {
    App.mutate(forge.updateTask(task.id, { status: "in-progress" }));
  }

  function truncate(text, n = 40) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }

  function actionGlyph(action) {
    const glyphs = {
      created: "+", updated: "~", completed: "\u2713", reopened: "\u25cb",
      deleted: "\u00d7", restored: "\u21ba", archived: "\u25a4",
      "priority-changed": "!", "status-changed": "\u2192", migrated: "\u21c4",
      pinned: "*", unarchived: "\u21ba", unpinned: "\u00b7", reset: "\u26a1",
      cleared: "\u2212",
    };
    return glyphs[action] || "\u2022";
  }

  /** Shared card renderer used by list views. */
  function buildCard(task, opts = {}) {
    const overdue = App.isOverdue(task);
    const project = task.projectId ? App.projectById(task.projectId) : null;

    const card = h("div", {
      class: `item-card prio-${task.priority}${overdue ? " overdue" : ""}`,
      dataset: { id: task.id },
      onclick: () => open(task.id),
    },
      h("button", {
        class: "item-check" + (["completed"].includes(task.status) ? " checked" : ""),
        title: task.status === "completed" ? "Reopen" : "Mark completed",
        html: task.status === "completed" ? App.icon("check", 12) : "",
        onclick: (e) => {
          e.stopPropagation();
          if (task.status === "completed") reopenTask(task);
          else completeTask(task);
        },
      }),
      h("div", { class: "item-main" },
        h("div", { class: "item-title-row" },
          task.pinned && h("span", { class: "pin-flag", title: "Pinned", html: App.icon("star", 11) }),
          h("span", { class: "item-title" + (["completed", "cancelled"].includes(task.status) ? " done" : "") },
            task.title)
        ),
        h("div", { class: "item-meta" },
          project && h("span", { class: "proj-inline" },
            h("span", { class: "proj-dot", style: { background: project.color || "#6c8cff" } }), project.name),
          task.dueDate && h("span", { class: overdue ? "due-overdue" : "" }, App.dueText(task) || App.fmtDate(task.dueDate)),
          opts.showCompletedAt && task.completedAt && `Completed ${App.relTime(task.completedAt)}`,
          opts.showArchivedAt && `Updated ${App.relTime(task.updatedAt)}`
        ),
        (task.tags.length || opts.showType !== false) &&
          h("div", { class: "item-tags-row" },
            opts.showType !== false && typeBadge(task.type),
            task.tags.map((t) => h("span", { class: "tag-chip sm" }, t))
          )
      ),
      h("div", { class: "item-side" },
        statusPill(task.status, async (status) => {
          await App.mutate(forge.updateTask(task.id, { status }));
        }),
        h("div", { class: "item-actions" },
          h("button", { class: "icon-btn", title: "Edit", html: App.icon("edit", 13),
            onclick: (e) => { e.stopPropagation(); App.forms.openTaskForm({ initial: task }); } }),
          h("button", { class: "icon-btn danger-hover", title: "Delete", html: App.icon("trash", 13),
            onclick: (e) => { e.stopPropagation(); App.workflows.deleteWithUndo(task); } })
        )
      )
    );
    return card;
  }

  App.buildTaskCard = buildCard;

  return { open, close, isOpen, refreshIfCurrent };
})();
