"use strict";

/* Command palette (Ctrl/Cmd+K): commands + live task/project search. */

App.palette = (() => {
  const { h } = App;
  let backdrop, inputEl, listEl;
  let items = [];
  let selected = 0;

  function isOpen() {
    return Boolean(backdrop);
  }

  function toggle() {
    isOpen() ? close() : open();
  }

  function open() {
    if (backdrop) return;
    const root = document.getElementById("palette-root");

    inputEl = h("input", {
      class: "palette-input",
      type: "text",
      placeholder: "Type a command or search work... ",
      oninput: () => {
        selected = 0;
        renderResults();
      },
      onkeydown: (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") { e.preventDefault(); execute(selected); }
        else if (e.key === "Escape") close();
      },
    });

    listEl = h("div", { class: "palette-list" });
    backdrop = h("div", { class: "palette-backdrop", onmousedown: (e) => { if (e.target === backdrop) close(); } },
      h("div", { class: "palette" },
        h("div", { class: "palette-input-wrap" },
          h("span", { class: "search-icon", html: App.icon("search", 15) }),
          inputEl
        ),
        listEl
      )
    );
    root.appendChild(backdrop);
    document.addEventListener("keydown", keyListener, true);

    renderResults();
    inputEl.focus();
  }

  function close() {
    if (!backdrop) return;
    const el = backdrop;
    backdrop = null;
    el.remove();
    document.removeEventListener("keydown", keyListener);
  }

  function keyListener(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function move(delta) {
    if (!items.length) return;
    selected = (selected + delta + items.length) % items.length;
    updateSelection();
  }

  function updateSelection() {
    [...listEl.children].forEach((el, i) => el.classList.toggle("selected", i === selected));
    const active = listEl.children[selected];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function buildItems(queryText) {
    const q = queryText.trim().toLowerCase();
    const commands = [
      { icon: "plus", text: "Create Work Item", hint: "N", fn: () => App.forms.openTaskForm({ initial: {} }) },
      { icon: "zap", text: "Quick Capture", hint: "Q", fn: () => App.forms.openQuickCapture() },
      { icon: "projects", text: "New Project", hint: "P", fn: () => App.forms.openProjectForm() },
      { type: "label", text: "Navigation" },
      { icon: "dashboard", text: "Go to Dashboard", hint: "1", fn: () => App.navigate("dashboard") },
      { icon: "work", text: "Go to My Work", hint: "2", fn: () => App.navigate("work") },
      { icon: "projects", text: "Go to Projects", hint: "3", fn: () => App.navigate("projects") },
      { icon: "calendar", text: "Go to Schedule", hint: "4", fn: () => App.navigate("calendar") },
      { icon: "activity", text: "Go to Activity", hint: "5", fn: () => App.navigate("activity") },
      { icon: "completed", text: "Show Completed", hint: "6", fn: () => App.navigate("completed") },
      { icon: "archive", text: "Go to Archive", hint: "7", fn: () => App.navigate("archive") },
      { icon: "settings", text: "Open Settings", hint: "8", fn: () => App.navigate("settings") },
      { type: "label", text: "Views" },
      { icon: "alert", text: "Show Overdue Work", fn: () => {
          Object.assign(App.ui.work, { status: "all", priority: "all", project: "all", type: "all", tag: "all", due: "overdue", query: "" });
          App.navigate("work");
        } },
      { icon: "target", text: "Focus Today", fn: () => App.navigate("dashboard") },
    ];

    let results = [];
    let labelSeen = false;

    for (const cmd of commands) {
      if (cmd.type === "label") { labelSeen = false; continue; }
      if (!q || cmd.text.toLowerCase().includes(q)) {
        if (!labelSeen && q) labelSeen = true;
        results.push(cmd);
      }
    }

    // dynamic search across tasks and projects when there's a query
    if (q) {
      const taskHits = App.state.tasks
        .filter((t) => !t.archived)
        .filter((t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q)))
        .slice(0, 6);
      const projHits = App.state.projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 4);

      if (taskHits.length || projHits.length) {
        results.push({ type: "label", text: "Work Items" });
        for (const t of taskHits) {
          results.push({
            icon: "work",
            text: t.title,
            sub: `${App.statusLabel(t.status)} \u00b7 ${App.priorityLabel(t.priority)}${t.projectId && App.projectById(t.projectId) ? " \u00b7 " + App.projectById(t.projectId).name : ""}`,
            fn: () => App.detail.open(t.id),
          });
        }
        if (projHits.length) {
          results.push({ type: "label", text: "Projects" });
          for (const p of projHits) {
            results.push({
              icon: "projects",
              text: p.name,
              sub: `${App.projectProgress(p).total} item(s)`,
              fn: () => { App.ui.projects.openId = p.id; App.navigate("projects"); },
            });
          }
        }
      }
    }

    return results;
  }

  function renderResults() {
    App.clear(listEl);
    items = buildItems(inputEl.value);

    if (!items.length) {
      listEl.append(h("div", { class: "palette-empty" }, "No matching commands or work."));
      return;
    }

    items.forEach((item, i) => {
      if (item.type === "label") {
        listEl.append(h("div", { class: "palette-group-label" }, item.text));
        return;
      }
      listEl.append(
        h("div", {
          class: `palette-item${i === selected ? " selected" : ""}`,
          onmouseenter: () => { selected = i; updateSelection(); },
          onclick: () => execute(i),
        },
          h("span", { class: "pi-icon", html: App.icon(item.icon, 14) }),
          h("span", { class: "pi-text" },
            item.text,
            item.sub && h("span", { class: "pi-sub" }, ` \u2014 ${item.sub}`)
          ),
          item.hint && h("kbd", null, item.hint)
        )
      );
    });
  }

  async function execute(index) {
    const item = items[index];
    if (!item || item.type === "label") return;
    close();
    await item.fn();
  }

  return { open, close, toggle, isOpen };
})();
