"use strict";

/* Personal developer dashboard: focus, overdue, upcoming, recent, projects. */

(() => {
  const { h } = App;

  function stat(value, label, tone) {
    return h("div", { class: `stat-card${tone ? " " + tone : ""}` },
      h("span", { class: "stat-value" }, String(value)),
      h("span", { class: "stat-label" }, label)
    );
  }

  function widget(titleText, iconName, bodyEl, opts = {}) {
    return h("section", { class: "widget" + (opts.wide ? " wide" : "") },
      h("div", { class: "widget-head" },
        h("h3", { class: "widget-title" },
          h("span", { class: "widget-icon", html: App.icon(iconName, 13) }),
          titleText
        ),
        opts.link && h("button", {
          class: "link-btn",
          onclick: () => (opts.link === "overdue" ? goFilteredOverdue() : App.navigate(opts.link)),
        }, "View all")
      ),
      bodyEl
    );
  }

  function goFilteredOverdue() {
    const ui = App.ui.work;
    Object.assign(ui, { status: "all", priority: "all", project: "all", type: "all", tag: "all", due: "overdue", query: "" });
    App.navigate("work");
  }

  function miniList(tasks, emptyIconName, emptyTitle, emptyHint, opts = {}) {
    if (!tasks.length) return App.emptyState(emptyIconName, emptyTitle, emptyHint);
    return h("ul", { class: "mini-list" },
      tasks.map((t) => {
        const overdue = App.isOverdue(t);
        return h("li", {
          class: "mini-item",
          dataset: { id: t.id },
          onclick: () => App.detail.open(t.id),
        },
          h("span", { class: `prio-dot p-${t.priority}`, title: App.priorityLabel(t.priority) }),
          h("div", { class: "mini-main" },
            h("span", { class: "mini-title" }, t.title),
            h("span", { class: "mini-meta" },
              t.projectId && App.projectById(t.projectId)
                ? `${App.projectById(t.projectId).name} \u00b7 `
                : "",
              t.dueDate
                ? h("span", { class: overdue ? "due-overdue" : "" }, App.dueText(t) || App.fmtDate(t.dueDate))
                : App.statusLabel(t.status)
            )
          ),
          h("button", {
            class: "icon-btn",
            title: "Mark completed",
            html: App.icon("check", 13),
            onclick: async (e) => {
              e.stopPropagation();
              if (await App.mutate(forge.updateTask(t.id, { status: "completed" })))
                App.toast.show({ msg: `Completed \u201c${truncate(t.title)}\u201d`, kind: "success" });
            },
          })
        );
      })
    );
  }

  function truncate(text, n = 48) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }

  App.views.dashboard = {
    render(container) {
      const today = App.todayStr();
      const active = App.activeTasks();
      const open = active.filter((t) => t.status !== "blocked");
      const blocked = active.filter((t) => t.status === "blocked");
      const inProgress = active.filter((t) => t.status === "in-progress");
      const overdue = active.filter((t) => App.isOverdue(t));
      const dueToday = active.filter((t) => t.dueDate === today);

      const weekEnd = App.addDays(today, 7);
      const upcoming = App.sortTasks(
        active.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd && !overdue.includes(t)),
        "due"
      ).slice(0, 5);

      const completedToday = App.state.tasks.filter(
        (t) => t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()
      );
      const weekAgoTs = Date.now() - 7 * 86400000;
      const completedWeek = App.state.tasks.filter((t) => t.completedAt && t.completedAt >= weekAgoTs);

      const recentlyUpdated = App.sortTasks(active, "updated").slice(0, 5);
      const highPriority = active.filter((t) => ["critical", "high"].includes(t.priority));

      /* greeting */
      const hour = new Date().getHours();
      const partOfDay = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      const dateLine = new Date().toLocaleDateString(undefined, {
        weekday: "long", month: "long", day: "numeric",
      });

      /* KPI row */
      const kpis = h("div", { class: "kpi-row" },
        stat(active.length, "Active"),
        stat(inProgress.length, "In Progress", inProgress.length ? "accent" : ""),
        stat(overdue.length, "Overdue", overdue.length ? "danger" : ""),
        stat(completedToday.length, "Done today", completedToday.length ? "success" : "")
      );

      /* quick capture bar */
      const quickInput = h("input", {
        class: "search-input capture-input",
        type: "text",
        placeholder: "Quick capture \u2014 type a task and press Enter...",
        maxlength: 300,
        onkeydown: async (e) => {
          if (e.key !== "Enter") return;
          const title = quickInput.value.trim();
          if (!title) return;
          const result = await forge.createTask({ title, status: "planned", type: "other" });
          if (App.applyResult(result)) {
            quickInput.value = "";
            const newId = result.state.tasks[0] && result.state.tasks[0].id;
            if (newId) App.flashCard(newId);
            App.toast.show({ msg: "Captured \u2014 plan it when ready", kind: "success" });
          }
        },
      });

      /* focus today */
      const pinnedFirst = [...active].sort((a, b) => Number(b.pinned) - Number(a.pinned));
      const focus = [
        ...pinnedFirst.filter((t) => t.pinned),
        ...pinnedFirst.filter((t) => !t.pinned && (t.dueDate === today || t.status === "in-progress")),
        ...pinnedFirst.filter((t) => !t.pinned && t.dueDate !== today && t.status !== "in-progress"),
      ].slice(0, 6);

      /* projects */
      const activeProjects = App.state.projects.filter((p) => p.status === "active");
      let projBody;
      if (!activeProjects.length) {
        projBody = App.emptyState("projects", "No projects yet", "Create your first project to organize related work.");
      } else {
        projBody = h("ul", { class: "proj-mini-list" },
          activeProjects.slice(0, 5).map((p) => {
            const prog = App.projectProgress(p);
            return h("li", {
              class: "proj-mini",
              onclick: () => {
                App.ui.projects.openId = p.id;
                App.navigate("projects");
              },
            },
              h("span", { class: "proj-dot lg", style: { background: p.color || "#6c8cff" } }),
              h("div", { class: "proj-mini-main" },
                h("div", { class: "proj-mini-top" },
                  h("span", { class: "mini-title" }, p.name),
                  h("span", { class: "muted small" }, `${prog.done}/${prog.total}`)
                ),
                h("div", { class: "progress-track sm" },
                  h("div", { class: "progress-fill", style: { width: prog.pct + "%" } })
                )
              )
            );
          })
        );
      }

      /* analytics strip */
      const monthAgoTs = Date.now() - 30 * 86400000;
      const completedMonth = App.state.tasks.filter((t) => t.completedAt && t.completedAt >= monthAgoTs).length;
      const activeProjectsSummary = App.state.projects.filter((p) => p.status === "active");
      const projectProgress = activeProjects.reduce((acc, p) => {
        const prog = App.projectProgress(p);
        acc.total += prog.total;
        acc.done += prog.done;
        return acc;
      }, { total: 0, done: 0 });
      const avgCompletion = projectProgress.total ? Math.round((projectProgress.done / projectProgress.total) * 100) : 0;
      const sessionCount = App.state.tasks.filter((t) => t.projectId).length;
      const devPulse = h("section", { class: "widget wide command-center" },
        h("div", { class: "widget-head" },
          h("h3", { class: "widget-title" },
            h("span", { class: "widget-icon", html: App.icon("command", 13) }),
            "Developer Command Center"
          )
        ),
        h("div", { class: "command-grid" },
          h("div", { class: "command-card" },
            h("span", { class: "command-kicker" }, "Workstream"),
            h("strong", null, `${active.length} open item(s)`),
            h("p", { class: "muted small" }, "Focus on the next meaningful task, not the whole backlog.")
          ),
          h("div", { class: "command-card" },
            h("span", { class: "command-kicker" }, "Git"),
            h("strong", null, "Safe main-process service"),
            h("p", { class: "muted small" }, "Git operations will be routed through validated IPC calls.")
          ),
          h("div", { class: "command-card" },
            h("span", { class: "command-kicker" }, "Terminal"),
            h("strong", null, "Session-based control"),
            h("p", { class: "muted small" }, "Interactive shells stay behind explicit main-process sessions.")
          ),
          h("div", { class: "command-card" },
            h("span", { class: "command-kicker" }, "Projects"),
            h("strong", null, `${activeProjectsSummary.length} active project(s)`),
            h("p", { class: "muted small" }, `Average project completion: ${avgCompletion}%`)
          ),
          h("div", { class: "command-card" },
            h("span", { class: "command-kicker" }, "Sessions"),
            h("strong", null, `${sessionCount} linked task(s)`),
            h("p", { class: "muted small" }, "Tasks can later reference files, Git and terminal context.")
          )
        )
      );

      container.append(
        h("div", { class: "dash-greeting" },
          h("div", null,
            h("h1", { class: "page-title" }, `${partOfDay}. Here's your workspace.`),
            h("p", { class: "page-subtitle" }, dateLine)
          ),
          h("div", { class: "page-actions" },
            h("button", {
              class: "btn ghost",
              html: `${App.icon("zap", 14)} <span>Quick Capture</span>`,
              onclick: () => App.forms.openQuickCapture(),
            }),
            h("button", {
              class: "btn primary",
              html: `${App.icon("plus", 14)} <span>New Work Item</span>`,
              onclick: () => App.forms.openTaskForm({ initial: {} }),
            })
          )
        ),
        quickInput,
        kpis,
        devPulse,

        h("div", { class: "widgets-grid" },
          widget("Focus Today", "target",
            miniList(focus.slice(0, 5), "target", "Nothing scheduled for today",
              focus.length ? "" : "Pull something forward from My Work or enjoy the clear runway."),
            { link: "work", wide: true }
          ),
          widget("Upcoming Deadlines", "calendar",
            miniList(upcoming, "calendar", "No deadlines this week", "Add due dates to see what's coming."),
            { link: "calendar" }
          ),
          widget("Overdue", "alert",
            miniList(overdue.slice(0, 5), "check", overdue.length ? "" : "No overdue work", overdue.length ? "" : "You're caught up."),
            { link: "overdue" }
          ),
          widget("Blocked", "alert",
            miniList(blocked.slice(0, 4), "inbox", "Nothing blocked", "Smooth sailing \u2014 nothing is waiting on others.")
          ),
          widget("Recently Updated", "activity",
            miniList(recentlyUpdated.slice(0, 4), "activity", "No activity yet", "Updates to your work will appear here."),
            { link: "work" }
          ),
          widget("Projects", "projects", projBody, { link: "projects" }),
          widget("Productivity", "trendUp",
            h("ul", { class: "breakdown" },
              h("li", null, "Completed today ", h("span", { class: "prio-count" }, String(completedToday.length))),
              h("li", null, "Completed this week ", h("span", { class: "prio-count" }, String(completedWeek.length))),
              h("li", null, "Completed this month ", h("span", { class: "prio-count" }, String(completedMonth))),
              h("li", null, "High priority open ",
                h("span", { class: `prio-count${highPriority.length ? " warn" : ""}` }, String(highPriority.length)))
            )
          ),
          widget("Recently Completed", "completed",
            miniList(
              completedWeek.slice(0, 4),
              "completed",
              "No completions this week",
              "Close out a task to start the streak."
            ),
            { link: "completed" }
          )
        )
      );
    },
  };
})();
