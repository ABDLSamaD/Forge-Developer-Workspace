"use strict";

/* Forge renderer shared utilities, constants and API wrapper. */
window.App = { ui: {}, views: {} };

/* ------------------------------ DOM -------------------------------- */

App.h = function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
      else if (key.startsWith("on") && typeof value === "function")
        el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "html") el.innerHTML = value; // trusted markup (icons only)
      else if (key in el && key !== "list" && key !== "form" && key !== "type") {
        try { el[key] = value; } catch { el.setAttribute(key, value); }
      } else el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  appendChildren(el, children);
  return el;
};

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

App.clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

App.debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/* ----------------------------- icons ------------------------------- */

const ICON_PATHS = {
  dashboard: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  work: '<polyline points="9 11 12 14 22 4"/><path d="M21 14v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  projects: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  completed: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  command: '<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trendUp: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
};

App.icon = function icon(name, size = 16) {
  const path = ICON_PATHS[name] || ICON_PATHS.inbox;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
};

/* ---------------------------- constants ---------------------------- */

Object.assign(App, {
  STATUSES: [
    ["backlog", "Backlog"],
    ["planned", "Planned"],
    ["in-progress", "In Progress"],
    ["blocked", "Blocked"],
    ["review", "Review"],
    ["testing", "Testing"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ],
  OPEN_STATUSES: ["backlog", "planned", "in-progress", "blocked", "review", "testing"],
  PRIORITIES: [
    ["critical", "Critical"],
    ["high", "High"],
    ["medium", "Medium"],
    ["low", "Low"],
  ],
  TYPES: [
    ["feature", "Feature"],
    ["bug", "Bug"],
    ["commit", "Commit"],
    ["improvement", "Improvement"],
    ["research", "Research"],
    ["refactor", "Refactor"],
    ["documentation", "Docs"],
    ["testing", "Testing"],
    ["deployment", "Deploy"],
    ["maintenance", "Maintenance"],
    ["meeting", "Meeting"],
    ["personal", "Personal"],
    ["other", "Other"],
  ],
  EFFORTS: [
    ["small", "S"],
    ["medium", "M"],
    ["large", "L"],
  ],
  PROJECT_STATUSES: [
    ["active", "Active"],
    ["on-hold", "On Hold"],
    ["completed", "Completed"],
  ],
});

App.label = (pairs, id) => {
  const found = pairs.find(([p]) => p === id);
  return found ? found[1] : id;
};
App.statusLabel = (id) => App.label(App.STATUSES, id);
App.priorityLabel = (id) => App.label(App.PRIORITIES, id);
App.typeLabel = (id) => App.label(App.TYPES, id);

/* ----------------------------- dates ------------------------------- */

App.todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

App.addDays = (iso, days) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

App.fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

App.daysBetween = (fromIso, toIso) =>
  Math.round((new Date(toIso + "T00:00:00") - new Date(fromIso + "T00:00:00")) / 86400000);

App.isOverdue = (task) =>
  !task.archived &&
  task.dueDate &&
  !["completed", "cancelled"].includes(task.status) &&
  task.dueDate < App.todayStr();

App.relTime = (ts) => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

App.dueText = (task) => {
  if (!task.dueDate) return null;
  const days = App.daysBetween(App.todayStr(), task.dueDate);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days <= 7) return `Due in ${days}d`;
  return `Due ${App.fmtDate(task.dueDate)}`;
};

/* ------------------------- derived queries -------------------------- */

App.activeTasks = () =>
  App.state.tasks.filter((t) => !t.archived && !["completed", "cancelled"].includes(t.status));

App.taskById = (id) => App.state.tasks.find((t) => t.id === id) || null;

App.projectById = (id) => App.state.projects.find((p) => p.id === id) || null;

App.projectName = (id) => {
  const p = App.projectById(id);
  return p ? p.name : null;
};

App.allTags = () => {
  const set = new Set();
  for (const t of App.state.tasks) t.tags.forEach((tag) => set.add(tag));
  return [...set].sort();
};

App.projectProgress = (project) => {
  const tasks = App.state.tasks.filter((t) => t.projectId === project.id && t.status !== "cancelled");
  const done = tasks.filter((t) => t.status === "completed").length;
  return { total: tasks.length, done, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
};

/* --------------------------- sorting ------------------------------- */

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

App.sortTasks = (tasks, mode) => {
  const list = [...tasks];
  switch (mode) {
    case "priority":
      list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
      break;
    case "due":
      list.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      });
      break;
    case "updated":
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
    case "oldest":
      list.sort((a, b) => a.createdAt - b.createdAt);
      break;
    case "alpha":
      list.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      list.sort((a, b) => b.createdAt - a.createdAt); // newest
  }
  return list;
};

App.matchQuery = (task, q) => {
  if (!q) return true;
  const hay = [
    task.title,
    task.description,
    task.notes,
    App.projectName(task.projectId) || "",
    App.typeLabel(task.type),
    App.statusLabel(task.status),
    ...task.tags,
  ]
    .join(" ")
    .toLowerCase();
  return q.toLowerCase().split(/\s+/).every((word) => hay.includes(word));
};

/* ---------------------------- mutations ---------------------------- */

App.applyResult = (result, opts) => {
  if (result && result.ok) {
    App.state = result.state;
    if (result.rev != null) App._stateRev = result.rev;
    if (opts && opts.silent !== true) App.refreshView();
    return true;
  }
  App.toast.show({ msg: (result && result.error) || "Something went wrong", kind: "error" });
  return false;
};

App.mutate = async (promise, opts) => App.applyResult(await promise, opts);

/**
 * Draw the eye to a freshly created/updated item: scroll it into view and
 * pulse-highlight its card so the save feels immediate.
 */
App.flashCard = (id) => {
  if (!id) return;
  const sel = CSS.escape(String(id));
  const el =
    document.querySelector(`.item-card[data-id="${sel}"]`) ||
    document.querySelector(`.mini-item[data-id="${sel}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation if it is already flashing
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1800);
};
