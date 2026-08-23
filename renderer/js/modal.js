"use strict";

/* Generic modal host: App.modal.open({ title, body, footer, width }) */

App.modal = (() => {
  let backdrop;

  function isOpen() {
    return Boolean(backdrop);
  }

  function close() {
    if (!backdrop) return;
    const el = backdrop;
    backdrop = null;
    el.classList.add("closing");
    setTimeout(() => el.remove(), 150);
    document.removeEventListener("keydown", escListener);
  }

  function escListener(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function open({ title, body, footer, width }) {
    close();
    const root = document.getElementById("modal-root");

    const dialog = App.h("div", { class: "modal", role: "dialog", style: width ? { maxWidth: width } : null },
      App.h("div", { class: "modal-head" },
        App.h("h3", { class: "modal-title" }, title),
        App.h("button", { class: "icon-btn", title: "Close", html: App.icon("x", 15), onclick: close })
      ),
      App.h("div", { class: "modal-body" }, body),
      footer && App.h("div", { class: "form-actions" }, footer)
    );

    backdrop = App.h("div", {
      class: "modal-backdrop",
      onmousedown: (e) => { if (e.target === backdrop) close(); },
    }, dialog);

    root.appendChild(backdrop);
    document.addEventListener("keydown", escListener, true);

    const firstField = dialog.querySelector("input, textarea, select");
    if (firstField) firstField.focus();

    return { close, dialog };
  }

  return { open, close, isOpen };
})();
