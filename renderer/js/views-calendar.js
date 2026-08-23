"use strict";

/* Calendar: month grid, drag-and-drop rescheduling, workload summary. */

(() => {
  const { h } = App;

  App.views.calendar = {
    render(container) {
      const ui = App.ui.calendar;
      const today = App.todayStr();

      /* ---- summary strip ---- */
      const open = App.activeTasks();
      const overdueCount = open.filter((t) => App.isOverdue(t)).length;
      const todayCount = open.filter((t) => t.dueDate === today).length;
      const weekEnd = App.addDays(today, 7);
      const weekCount = open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd).length;

      container.append(
        h("div", { class: "page-header" },
          h("div", null,
            h("h1", { class: "page-title" }, "Schedule"),
            h("p", { class: "page-subtitle" }, "Plan and reschedule work by date \u2014 drag items between days")
          )
        ),
        h("div", { class: "summary-strip" },
          summaryChip(`${overdueCount} overdue`, overdueCount ? "danger" : "", () => jumpToOverdue()),
          summaryChip(`${todayCount} due today`, todayCount ? "accent" : "", () => jumpToDue("today")),
          summaryChip(`${weekCount} this week`, "", () => jumpToDue("week"))
        )
      );

      /* ---- toolbar ---- */
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const [year, month] = ui.month.split("-").map(Number);
      const title = `${monthNames[month - 1]} ${year}`;

      const shiftMonth = async (delta) => {
        const d = new Date(year, month - 1 + delta, 1);
        ui.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        App.refreshView();
      };

      container.append(
        h("div", { class: "cal-toolbar" },
          h("button", { class: "icon-btn lg", title: "Previous month", html: App.icon("chevronLeft", 16), onclick: () => shiftMonth(-1) }),
          h("h2", { class: "cal-title" }, title),
          h("button", { class: "icon-btn lg", title: "Next month", html: App.icon("chevronRight", 16), onclick: () => shiftMonth(1) }),
          h("button", { class: "btn ghost sm", onclick: () => { ui.month = today.slice(0, 7); App.refreshView(); } }, "Today")
        )
      );

      /* ---- grid ---- */
      const grid = h("div", { class: "cal-grid" });
      for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        grid.append(h("div", { class: "cal-dow" }, day));
      }

      // Build weeks starting Monday
      const firstOfMonth = new Date(year, month - 1, 1);
      let startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday=0
      const gridStart = new Date(year, month - 1, 1 - startOffset);

      const tasksByDay = {};
      for (const t of App.state.tasks) {
        if (t.archived || !t.dueDate) continue;
        if (!tasksByDay[t.dueDate]) tasksByDay[t.dueDate] = [];
        tasksByDay[t.dueDate].push(t);
      }

      for (let cellIndex = 0; cellIndex < 42; cellIndex++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + cellIndex);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
        const inMonth = d.getMonth() === month - 1;
        const isToday = iso === today;

        const chips = (tasksByDay[iso] || [])
          .filter((t) => t.status !== "cancelled")
          .sort((a, b) => a.priority.localeCompare(b.priority))
          .slice(0, 3);
        const extraCount = (tasksByDay[iso] || []).filter((t) => t.status !== "cancelled").length - chips.length;

        const chipEls = chips.map((t) =>
          h("button", {
            class: `cal-chip prio-${t.priority}${["completed"].includes(t.status) ? " done" : ""}`,
            draggable: true,
            title: `${t.title} \u2014 drop on another day to reschedule`,
            dataset: { id: t.id },
            onclick: (e) => { e.stopPropagation(); App.detail.open(t.id); },
            ondragstart: (e) => {
              e.dataTransfer.setData("text/task-id", t.id);
              e.dataTransfer.effectAllowed = "move";
            },
          },
            h("span", { class: "cal-chip-title" }, truncate(t.title, 22))
          )
        );

        const cell = h("div", {
          class: `cal-cell${inMonth ? "" : " other-month"}${isToday ? " today" : ""}`,
          dataset: { date: iso },
          onclick: () => quickCreateFor(iso),
          ondragover: (e) => { e.preventDefault(); cell.classList.add("drag-over"); },
          ondragleave: () => cell.classList.remove("drag-over"),
          ondrop: (e) => {
            e.preventDefault();
            cell.classList.remove("drag-over");
            const taskId = e.dataTransfer.getData("text/task-id");
            if (!taskId) return;
            reschedule(taskId, iso);
          },
        },
          h("span", { class: "cal-daynum" }, String(d.getDate())),
          h("div", { class: "cal-chips" }, chipEls),
          extraCount > 0 && h("button", {
            class: "cal-more",
            onclick: (e) => { e.stopPropagation(); jumpToDueList(iso); },
          }, `+${extraCount} more`)
        );
        grid.append(cell);
      }

      container.append(grid);
    },
  };

  function summaryChip(labelText, tone, onclickFn) {
    return h("button", { class: `sum-chip ${tone}`, onclick: onclickFn }, labelText);
  }

  function jumpToOverdue() {
    Object.assign(App.ui.work, { status: "all", priority: "all", project: "all", type: "all", tag: "all", due: "overdue", query: "" });
    App.navigate("work");
  }

  function jumpToDue(kind) {
    Object.assign(App.ui.work, { status: "all", priority: "all", project: "all", type: "all", tag: "all", due: kind, query: "" });
    App.navigate("work");
  }

  function jumpToDueList(dateIso) {
    Object.assign(App.ui.work, { status: "all", priority: "all", project: "all", type: "all", tag: "all", due: "all", query: "" });
    App.ui.work._dateJump = dateIso;
    App.navigate("work");
  }

  async function reschedule(taskId, dateIso) {
    const task = App.taskById(taskId);
    if (!task || task.dueDate === dateIso) return;
    if (await App.mutate(forge.updateTask(taskId, { dueDate: dateIso }), { silent: true })) {
      App.toast.show({ msg: `\u201c${truncate(task.title)}\u201d moved to ${App.fmtDate(dateIso)}`, kind: "success" });
      App.refreshView();
    }
  }

  function quickCreateFor(iso) {
    App.forms.openTaskForm({ initial: { dueDate: iso, status: "planned" } });
  }

  function truncate(text, n = 26) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }

  // Work view consumes _dateJump once to pre-filter by exact date.
  const originalWorkRender = App.views.work.render.bind(App.views.work);
  App.views.work.render = function patched(container) {
    originalWorkRender(container);
    const jump = App.ui.work._dateJump;
    if (jump) {
      delete App.ui.work._dateJump;
      const box = container.querySelector(".list-stack");
      const line = container.querySelector(".count-line");
      if (box && line) {
        App.clear(box);
        const items = App.state.tasks.filter((t) => t.dueDate === jump && !t.archived);
        line.textContent = `${items.length} item(s) due ${App.fmtDate(jump)}`;
        if (!items.length) box.append(App.emptyState("calendar", "Nothing due that day", "Pick another date or add new work."));
        items.forEach((t) => box.append(App.buildTaskCard(t)));
      }
    }
  };
})();
