"use strict";

/* Toast notification system with optional action button (Undo). */

App.toast = (() => {
  let root;

  function ensureRoot() {
    if (!root) root = document.getElementById("toast-root");
    return root;
  }

  /**
   * show({ msg, kind='info', action={label, fn}, duration=4200 })
   * Returns a close() function.
   */
  function show({ msg, kind = "info", action, duration = 4200 }) {
    const host = ensureRoot();
    while (host.children.length >= 3) host.removeChild(host.firstChild);

    const close = () => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 180);
      clearTimeout(timer);
    };

    const el = App.h("div", { class: `toast ${kind}` },
      App.h("span", { class: "toast-msg" }, msg),
      action && App.h("button", {
        class: "toast-action",
        onclick: async (e) => { e.stopPropagation(); await action.fn(); close(); },
      }, action.label),
      App.h("button", { class: "toast-close", title: "Dismiss", html: App.icon("x", 13), onclick: close })
    );

    host.appendChild(el);
    const timer = setTimeout(close, action ? Math.max(duration, 5600) : duration);
    return close;
  }

  /** Deletion toast aligned with the server-side undo window. */
  function deletion(msg, undoFn) {
    return show({
      msg,
      kind: "delete",
      action: { label: "Undo", fn: undoFn },
      duration: 5200,
    });
  }

  return { show, deletion };
})();
