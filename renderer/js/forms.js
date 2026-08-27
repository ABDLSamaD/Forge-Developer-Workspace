"use strict";

/* Create / edit forms for work items and projects, plus confirm dialog. */

App.forms = (() => {
  const { h } = App;

  /* ------------------------- field helpers ------------------------- */

  function field(labelText, control, required) {
    return h("div", { class: "field" },
      h("label", { class: "label" }, labelText, required && h("span", { class: "req" }, "*")),
      control
    );
  }

  function select(options, value, attrs) {
    return h("select", { class: "select", ...attrs },
      options.map(([val, label]) => h("option", { value: val, selected: val === value }, label))
    );
  }

  function textInput(value, placeholder, attrs) {
    return h("input", { class: "input", type: "text", value: value || "", placeholder, ...attrs });
  }

  function textarea(value, placeholder, rows) {
    return h("textarea", { class: "textarea", rows: rows || 3, placeholder }, value || "");
  }

  /* --------------------------- task form --------------------------- */

  /**
   * initial: existing task (edit) or partial preset (create)
   * onSaved: called after successful save
   */
  function openTaskForm({ initial = {}, onSaved }) {
    const isEdit = Boolean(initial.id);

    const title = textInput(initial.title, "e.g. Fix auth token refresh", { maxlength: 300 });
    const projectSel = select(
      [["", "No project"], ...App.state.projects.map((p) => [p.id, p.name])],
      initial.projectId || ""
    );
    const prioSel = select(App.PRIORITIES, initial.priority || "medium");
    const dueInput = h("input", { class: "input", type: "date", value: initial.dueDate || "" });
    const typeSel = select(App.TYPES, initial.type || "feature");
    const statusSel = select(App.STATUSES, initial.status || "planned");
    const effortSel = select(App.EFFORTS.map(([v, l]) => [v, `Effort: ${l}`]), initial.effort || "medium");
    const startInput = h("input", { class: "input", type: "date", value: initial.startDate || "" });
    const descEl = textarea(initial.description, "What needs to be done?", 3);
    const notesEl = textarea(initial.notes, "Technical notes, links, decisions...", 3);
    const tagsInput = textInput((initial.tags || []).join(", "), "bug, api, urgent");
    const fileNameInput = textInput(initial.fileName || "", "src/app/work.ts", { maxlength: 300 });
    const filePathInput = textInput(initial.filePath || "", "Project file or folder path");
    const commitInput = textInput(initial.commitId || "", "Commit hash or short id");
    const extraDetailsInput = textarea(initial.extraDetails || "", "Extra details for commit context, file references, decisions...", 3);
    const isCommitType = () => typeSel.value === "commit";
    const commitHint = h("p", { class: "muted small-note commit-hint" }, "Select Commit to add file, commit and notes context.");

    let moreOpen = false;
    const moreSection = h("div", { class: "collapsible" },
      h("div", { class: "form-grid" },
        field("Status", statusSel),
        field("Type", typeSel),
        field("Description", descEl),
        field("Tags (comma separated)", tagsInput),
        field("Start date", startInput),
        field("Estimate", effortSel),
        field("Notes", notesEl, null)
      ),
      h("div", { class: "section-label" }, "Commit Context"),
      h("div", { class: "form-grid" },
        field("File name", fileNameInput),
        field("File path / folder", filePathInput),
        field("Commit ID", commitInput),
        field("Extra details", extraDetailsInput)
      )
    );

    const moreBtn = h("button", {
      type: "button",
      class: "link-btn more-toggle",
      onclick: () => {
        moreOpen = !moreOpen;
        moreSection.classList.toggle("open", moreOpen);
        moreBtn.textContent = moreOpen ? "Fewer options" : "More options";
      },
    }, "More options");

    const errorLine = h("div", { class: "form-error hidden" });

    const saveBtn = h("button", { class: "btn primary", type: "submit" }, isEdit ? "Save changes" : "Create item");
    const cancelBtn = h("button", { class: "btn ghost", type: "button", onclick: () => modal.close() }, "Cancel");

    const projectSummary = h("div", { class: "project-summary-card hidden", dataset: { kind: "project-summary" } });

    const form = h("form", {
      class: "task-form",
      onsubmit: async (e) => {
        e.preventDefault();
        const titleVal = title.value.trim();
        if (!titleVal) {
          errorLine.textContent = "A title is required.";
          errorLine.classList.remove("hidden");
          title.focus();
          return;
        }

        const commitPayload = isCommitType();
        const payload = {
          title: titleVal,
          projectId: projectSel.value || null,
          priority: prioSel.value,
          dueDate: dueInput.value || null,
          status: initial.status || "planned",
          type: typeSel.value,
        };

        if (moreOpen || descEl.value.trim() || notesEl.value.trim() || tagsInput.value.trim() ||
            startInput.value || initial.effort !== undefined || initial.status || initial.type) {
          payload.status = statusSel.value;
          payload.description = descEl.value;
          payload.notes = notesEl.value;
          payload.startDate = startInput.value || null;
          payload.effort = effortSel.value;
          payload.tags = tagsInput.value.split(",").map((t) => t.trim()).filter(Boolean);
        } else {
          // keep expanded fields untouched when collapsed and previously set
          if (initial.description) payload.description = initial.description;
          if (initial.notes) payload.notes = initial.notes;
          if (initial.tags && initial.tags.length) payload.tags = initial.tags;
          if (initial.startDate) payload.startDate = initial.startDate;
          if (initial.effort) payload.effort = initial.effort;
        }

        if (commitPayload) {
          payload.fileName = fileNameInput.value.trim() || null;
          payload.filePath = filePathInput.value.trim() || null;
          payload.commitId = commitInput.value.trim() || null;
          payload.extraDetails = extraDetailsInput.value.trim() || null;
        } else {
          payload.fileName = null;
          payload.filePath = null;
          payload.commitId = null;
          payload.extraDetails = null;
        }

        saveBtn.disabled = true;
        const result = isEdit
          ? await forge.updateTask(initial.id, payload)
          : await forge.createTask(payload);
        saveBtn.disabled = false;

        if (App.applyResult(result)) {
          modal.close();
          App.toast.show({ msg: isEdit ? "Work item updated" : "Work item created", kind: "success" });
          const newId = isEdit ? initial.id : result.state.tasks[0] && result.state.tasks[0].id;
          if (newId) App.flashCard(newId);
          if (onSaved) onSaved(newId);
        }
      },
    },
      field("Title", title, true),
      h("div", { class: "form-grid col-2" },
        field("Project", projectSel),
        field("Priority", prioSel),
        field("Due date", dueInput)
      ),
      projectSummary,
      commitHint,
      moreBtn,
      moreSection,
      errorLine,
      h("div", { class: "form-actions" }, cancelBtn, saveBtn)
    );

    const modal = App.modal.open({
      title: isEdit ? "Edit Work Item" : "New Work Item",
      body: form,
      width: 520,
    });

    async function fillCommitFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text && !commitInput.value.trim()) commitInput.value = text.trim().slice(0, 120);
      } catch {
        /* clipboard unavailable */
      }
    }

    function refreshCommitFields() {
      const show = isCommitType();
      if (show && !moreOpen) {
        moreOpen = true;
        moreSection.classList.add("open");
        moreBtn.textContent = "Fewer options";
      }
      fileNameInput.closest(".field").style.display = show ? "" : "none";
      filePathInput.closest(".field").style.display = show ? "" : "none";
      commitInput.closest(".field").style.display = show ? "" : "none";
      extraDetailsInput.closest(".field").style.display = show ? "" : "none";
      commitHint.style.display = show ? "none" : "";
      filePathInput.placeholder = show && projectSel.value && App.projectById(projectSel.value)
        ? `Project root: ${App.projectById(projectSel.value).rootPath || "set project root in project details"}`
        : "Project file or folder path";
      if (show) fillCommitFromClipboard();
      const project = projectSel.value ? App.projectById(projectSel.value) : null;
      if (project) {
        projectSummary.classList.remove("hidden");
        App.clear(projectSummary);
        projectSummary.append(
            h("div", { class: "project-summary-head" },
              h("strong", null, project.name),
              h("span", { class: "muted small" }, `Project #${project.id.slice(0, 8)}`)
            ),
            project.description && h("p", { class: "muted small-note" }, project.description),
            h("div", { class: "project-summary-meta" },
              h("span", null, `Status: ${App.label(App.PROJECT_STATUSES, project.status)}`),
              h("span", null, `Priority: ${App.priorityLabel(project.priority)}`),
              project.targetDate && h("span", null, `Target: ${App.fmtDate(project.targetDate)}`),
              project.rootPath && h("span", null, `Root: ${project.rootPath}`)
            )
          );
      } else {
        projectSummary.classList.add("hidden");
        App.clear(projectSummary);
      }
    }

    typeSel.addEventListener("change", refreshCommitFields);
    projectSel.addEventListener("change", refreshCommitFields);
    refreshCommitFields();
  }

  /** Quick capture — one input, Enter creates. */
  function openQuickCapture(preset = {}) {
    const input = textInput("", "What are you working on? e.g. Fix Shopify token issue", { maxlength: 300 });
    const projectSel = select(
      [["", "No project"], ...App.state.projects.filter((p) => p.status === "active").map((p) => [p.id, p.name])],
      preset.projectId || ""
    );
    const prioSel = select(App.PRIORITIES, preset.priority || "medium");
    const dueInput = h("input", { class: "input", type: "date", value: preset.dueDate || "" });

    const fullFormBtn = h("button", { class: "btn ghost", type: "button" }, "Open full form...");
    const captureBtn = h("button", { class: "btn primary", type: "submit" }, "Capture");

    fullFormBtn.addEventListener("click", () => {
      const title = input.value.trim();
      modal.close();
      openTaskForm({ initial: { title, ...preset }, onSaved: preset.onSaved });
    });

    const form = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const title = input.value.trim();
        if (!title) return;
        const result = await forge.createTask({
          title,
          priority: prioSel.value,
          projectId: projectSel.value || null,
          dueDate: dueInput.value || null,
          type: preset.type || "other",
          status: preset.status || "planned",
        });
        if (App.applyResult(result)) {
          modal.close();
          const newId = result.state.tasks[0] && result.state.tasks[0].id;
          if (newId) App.flashCard(newId);
          App.toast.show({ msg: "Captured — enrich it anytime from its detail view", kind: "success" });
        }
      },
    },
      field("Title", input, true),
      h("div", { class: "form-grid col-2" },
        field("Project", projectSel),
        field("Priority", prioSel)
      ),
      field("Due date", dueInput),
      h("div", { class: "form-actions" }, fullFormBtn, captureBtn)
    );

    const modal = App.modal.open({ title: "Quick Capture", body: form, width: 460 });
  }

  /* -------------------------- project form ------------------------- */

  function openProjectForm({ initial = {}, onSaved } = {}) {
    const isEdit = Boolean(initial.id);
    const name = textInput(initial.name, "e.g. Client Application", { maxlength: 300 });
    const desc = textarea(initial.description, "What is this project about?", 2);
    const statusSel = select(App.PROJECT_STATUSES, initial.status || "active");
    const prioSel = select(App.PRIORITIES, initial.priority || "medium");
    const startInput = h("input", { class: "input", type: "date", value: initial.startDate || "" });
    const targetInput = h("input", { class: "input", type: "date", value: initial.targetDate || "" });
    const colorInput = h("input", { class: "color-input", type: "color", value: initial.color || "#6c8cff" });
    const tagsInput = textInput((initial.tags || []).join(", "), "client, web");
    const repoInput = textInput(initial.repoUrl || "", "https://github.com/...");
    const rootInput = textInput(initial.rootPath || "", "C:\\projects\\app");
    const extraNotes = textarea(initial.extraNotes || "", "Project files, IDs, handoff notes, setup details...", 3);
    const errorLine = h("div", { class: "form-error hidden" });

    const form = h("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        const nameVal = name.value.trim();
        if (!nameVal) {
          errorLine.textContent = "A project name is required.";
          errorLine.classList.remove("hidden");
          return;
        }
        const payload = {
          name: nameVal,
          description: desc.value,
          status: statusSel.value,
          priority: prioSel.value,
          startDate: startInput.value || null,
          targetDate: targetInput.value || null,
          color: colorInput.value,
          tags: tagsInput.value.split(",").map((t) => t.trim()).filter(Boolean),
          repoUrl: repoInput.value.trim() || null,
          rootPath: rootInput.value.trim() || null,
          extraNotes: extraNotes.value.trim() || null,
        };
        const result = isEdit
          ? await forge.updateProject(initial.id, payload)
          : await forge.createProject(payload);
        if (App.applyResult(result)) {
          modal.close();
          App.toast.show({ msg: isEdit ? "Project updated" : "Project created", kind: "success" });
          if (onSaved) onSaved(isEdit ? initial.id : result.state.projects[0].id);
        }
      },
    },
      field("Project name", name, true),
      field("Description", desc),
      h("div", { class: "form-grid col-3" },
        field("Status", statusSel),
        field("Priority", prioSel),
        field("Color", colorInput)
      ),
      h("div", { class: "form-grid col-2" },
        field("Start date", startInput),
        field("Target date", targetInput)
      ),
      field("Tags", tagsInput),
      h("div", { class: "section-label" }, "Project Details"),
      h("div", { class: "form-grid" },
        field("Repo URL", repoInput),
        field("Root path", rootInput),
        field("Extra notes", extraNotes)
      ),
      errorLine,
      h("div", { class: "form-actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => modal.close() }, "Cancel"),
        h("button", { class: "btn primary", type: "submit" }, isEdit ? "Save changes" : "Create project")
      )
    );

    const modal = App.modal.open({ title: isEdit ? "Edit Project" : "New Project", body: form, width: 480 });
  }

  /* --------------------------- confirm ----------------------------- */

  function confirm({ title = "Are you sure?", message, confirmLabel = "Confirm", danger = true, onConfirm }) {
    const body = h("div", null, h("p", { class: "confirm-msg" }, message));
    const footer = [
      h("button", { class: "btn ghost", type: "button", onclick: () => modal.close() }, "Cancel"),
      h("button", {
        class: `btn ${danger ? "danger" : "primary"}`,
        type: "button",
        onclick: async () => {
          modal.close();
          await onConfirm();
        },
      }, confirmLabel),
    ];
    const modal = App.modal.open({ title, body, footer, width: 400 });
  }

  return { openTaskForm, openQuickCapture, openProjectForm, confirm };
})();
