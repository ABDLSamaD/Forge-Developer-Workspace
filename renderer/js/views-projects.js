"use strict";

/* Projects: grid overview + detail sub-view. */

(() => {
  const { h } = App;

  App.views.projects = {
    render(container) {
      const openId = App.ui.projects.openId;
      const project = openId ? App.projectById(openId) : null;

      if (project) {
        renderDetail(container, project);
      } else {
        renderGrid(container);
      }
    },
  };

  function renderGrid(container) {
    const header = h("div", { class: "page-header" },
      h("div", null,
        h("h1", { class: "page-title" }, "Projects"),
        h("p", { class: "page-subtitle" }, "Group related work and track momentum")
      ),
      h("div", { class: "page-actions" },
        h("button", {
          class: "btn primary",
          html: `${App.icon("plus", 14)} <span>New Project</span>`,
          onclick: () => App.forms.openProjectForm(),
        })
      )
    );
    container.append(header);

    const projects = [...App.state.projects].sort((a, b) =>
      a.status === b.status ? b.updatedAt - a.updatedAt : a.status === "active" ? -1 : 1
    );

    if (!projects.length) {
      container.append(App.emptyState(
        "projects",
        "No projects yet",
        "Create your first project to organize related work."
      ));
      return;
    }

    const grid = h("div", { class: "card-grid" });
    for (const project of projects) {
      grid.append(projectCard(project));
    }
    container.append(grid);
  }

  function projectCard(project) {
    const prog = App.projectProgress(project);
    const active = prog.total - prog.done;
    const overdue = App.state.tasks.filter(
      (t) => t.projectId === project.id && App.isOverdue(t)
    ).length;

    return h("article", {
      class: `proj-card${project.status !== "active" ? " dim" : ""}`,
      onclick: () => {
        App.ui.projects.openId = project.id;
        App.refreshView();
      },
    },
      h("div", { class: "proj-card-top" },
        h("span", { class: "proj-dot lg", style: { background: project.color || "#6c8cff" } }),
        h("div", { class: "proj-card-name" },
          h("h3", null, project.name),
          h("span", { class: `status-pill s-${project.status === "active" ? "in-progress" : project.status === "completed" ? "completed" : "backlog"}` },
            App.label(App.PROJECT_STATUSES, project.status))
        ),
        h("button", {
          class: "icon-btn",
          title: "Edit project",
          html: App.icon("edit", 13),
          onclick: (e) => { e.stopPropagation(); App.forms.openProjectForm({ initial: project }); },
        })
      ),
      project.description && h("p", { class: "proj-desc" }, truncate(project.description, 90)),
      h("div", { class: "progress-track" },
        h("div", { class: "progress-fill", style: { width: prog.pct + "%" } })
      ),
      h("div", { class: "proj-stats-row" },
        h("span", null, `${prog.pct}% done`),
        h("span", null, `${active} active`),
        overdue > 0 && h("span", { class: "due-overdue" }, `${overdue} overdue`),
        project.targetDate && h("span", { class: "muted" }, `Target ${App.fmtDate(project.targetDate)}`)
      ),
      project.tags.length > 0 &&
        h("div", { class: "item-tags-row" }, project.tags.map((t) => h("span", { class: "tag-chip sm" }, t)))
    );
  }

  /* ---------------------------- detail ------------------------------ */

  function renderDetail(container, project) {
    const tasks = App.state.tasks.filter((t) => t.projectId === project.id);
    const open = tasks.filter((t) => !["completed", "cancelled"].includes(t.status));
    const done = tasks.filter((t) => t.status === "completed");
    const overdueList = open.filter((t) => App.isOverdue(t));
    const prog = App.projectProgress(project);

    const weekEndTs = Date.now() + 7 * 86400000;
    const upcoming = App.sortTasks(
      open.filter((t) => t.dueDate && new Date(t.dueDate + "T23:59:59").getTime() <= weekEndTs),
      "due"
    ).slice(0, 4);

    const recentActivity = App.state.activity
      .filter((a) => a.entity === "task" && tasks.some((t) => t.id === a.entityId))
      .slice(0, 6);

    const backBtn = h("button", {
      class: "btn ghost sm",
      html: `${App.icon("chevronLeft", 13)} <span>All Projects</span>`,
      onclick: () => {
        App.ui.projects.openId = null;
        App.refreshView();
      },
    });

    container.append(
      h("div", { class: "page-header" },
        h("div", null,
          backBtn,
          h("div", { class: "proj-detail-head" },
            h("span", { class: "proj-dot xl", style: { background: project.color || "#6c8cff" } }),
            h("div", null,
              h("h1", { class: "page-title" }, project.name),
              h("p", { class: "page-subtitle" },
                `${prog.done}/${prog.total || 0} completed \u00b7 ${open.length} active` +
                (overdueList.length ? ` \u00b7 ${overdueList.length} overdue` : "") +
                (project.targetDate ? ` \u00b7 Target ${App.fmtDate(project.targetDate)}` : "")
              )
            )
          )
        ),
        h("div", { class: "page-actions" },
          h("button", {
            class: "btn primary",
            html: `${App.icon("plus", 14)} <span>Add Work Item</span>`,
            onclick: () => App.forms.openTaskForm({ initial: { projectId: project.id } }),
          }),
          h("button", {
            class: "btn ghost",
            html: `${App.icon("edit", 14)} <span>Edit</span>`,
            onclick: () => App.forms.openProjectForm({ initial: project }),
          }),
          h("button", {
            class: "btn danger-ghost",
            html: `${App.icon("trash", 14)} <span>Delete</span>`,
            onclick: () => App.workflows.deleteProject(project),
          })
        )
      ),
      project.description && h("p", { class: "proj-detail-desc" }, project.description)
    );

    const widgets = [];

    widgets.push(h("section", { class: "widget wide" },
      widgetHead(`Active Work (${open.length})`),
      open.length
        ? h("div", { class: "list-stack compact" },
            App.sortTasks(open, "due").map((t) => App.buildTaskCard(t)))
        : App.emptyState("work", "No active work in this project", "Add a work item to get moving.")
    ));

    if (overdueList.length) {
      widgets.push(h("section", { class: "widget" },
        widgetHead(`Overdue (${overdueList.length})`),
        miniOverdue(overdueList.slice(0, 4))
      ));
    }

    widgets.push(h("section", { class: "widget" },
      widgetHead("Upcoming Deadlines"),
      upcoming.length
        ? miniDue(upcoming)
        : App.emptyState("calendar", "No upcoming deadlines", "Set due dates to plan this project's runway.")
    ));

    widgets.push(h("section", { class: "widget" },
      widgetHead(`Recent Activity`),
      recentActivity.length
        ? h("ul", { class: "mini-act-list" },
            recentActivity.map((a) =>
              h("li", { class: "mini-act" },
                h("span", { class: `act-icon a-${a.action}` },
                  (App.ACTION_GLYPHS[a.action] || "\u2022")),
                h("div", null,
                  h("div", { class: "act-line" },
                    h("b", null, actionLabel(a.action)),
                    a.details && h("span", { class: "act-details" }, ` \u2014 ${a.details}`)
                  ),
                  h("span", { class: "act-time" }, App.relTime(a.at))
                )
              )
            ))
        : App.emptyState("activity", "No activity yet", "Changes to this project's work will appear here.")
    ));

    widgets.push(h("section", { class: "widget" },
      widgetHead(`Completed (${done.length})`),
      done.length
        ? h("ul", { class: "mini-list" },
            App.sortTasks(done, "updated").slice(0, 4).map((t) =>
              h("li", { class: "mini-item", dataset: { id: t.id }, onclick: () => App.detail.open(t.id) },
                h("span", { class: "mini-title done" }, t.title),
                h("span", { class: "mini-meta muted" },
                  t.completedAt ? `Completed ${App.relTime(t.completedAt)}` : ""))
            ))
        : App.emptyState("completed", "No completions yet", "Finished items will collect here.")
    ));

    container.append(h("div", { class: "widgets-grid" }, widgets));
  }

  function widgetHead(text) {
    return h("h3", { class: "widget-title standalone" }, text);
  }

  function miniOverdue(list) {
    return h("ul", { class: "mini-list" },
      list.map((t) => rowLink(t, h("span", { class: "due-overdue" }, App.dueText(t)))))
  }

  function miniDue(list) {
    return h("ul", { class: "mini-list" },
      list.map((t) => rowLink(t, String(App.dueText(t) || App.fmtDate(t.dueDate)))))
  }

  function rowLink(task, rightEl) {
    return h("li", { class: "mini-item", dataset: { id: task.id }, onclick: () => App.detail.open(task.id) },
      h("span", { class: `prio-dot p-${task.priority}` }),
      h("span", { class: "mini-title" }, truncate(task.title, 40)),
      h("span", { class: "mini-meta" }, rightEl)
    );
  }

  function actionLabel(action) {
    const labels = App.ACTION_META || {};
    return labels[action] ? labels[action].label : action;
  }

  function truncate(text, n = 48) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }
})();
