"use strict";

/* Shared workflows: professional delete + 5-second undo, aligned with the
 * main-process soft-delete window. */

App.workflows = (() => {
  const { h } = App;

  /**
   * Delete a task through the undo workflow.
   * If settings.confirmDelete is on, ask first.
   */
  async function deleteWithUndo(task) {
    if (App.state.settings.confirmDelete) {
      App.forms.confirm({
        title: "Delete work item?",
        message: `\u201c${task.title}\u201d will be removed. You can undo for a few seconds.`,
        confirmLabel: "Delete",
        onConfirm: () => performDelete(task),
      });
    } else {
      await performDelete(task);
    }
  }

  async function performDelete(task) {
    const result = await forge.deleteTask(task.id);
    if (!App.applyResult(result)) return;

    let undone = false;
    const closeToast = App.toast.deletion(
      `Deleted \u201c${truncate(task.title)}\u201d`,
      async () => {
        undone = true;
        const restore = await forge.undeleteTask(task.id);
        if (App.applyResult(restore)) {
          App.toast.show({ msg: "Work item restored", kind: "success" });
        }
      }
    );

    // Mirror of the main-process window: after it passes the item is gone.
    setTimeout(() => {
      if (!undone && !result.state.tasks.some((t) => t.id === task.id)) {
        // Toast already dismissed by its own timer; nothing further to do.
      }
    }, 6100);
  }

  /** Project delete detaches tasks; confirm always. */
  function deleteProject(project) {
    const { total } = App.projectProgress(project);
    App.forms.confirm({
      title: "Delete project?",
      message:
        total > 0
          ? `\u201c${project.name}\u201d has ${total} linked work item(s). They will be kept, but detached from this project.`
          : `Delete empty project \u201c${project.name}\u201d?`,
      confirmLabel: "Delete project",
      onConfirm: async () => {
        if (await App.mutate(forge.deleteProject(project.id))) {
          App.toast.show({ msg: "Project deleted", kind: "success" });
          if (App.currentView() === "projects") App.ui.projects.openId = null;
          App.refreshView();
        }
      },
    });
  }

  /** Clear activity log with confirmation. */
  function clearActivityLog() {
    App.forms.confirm({
      title: "Clear activity log?",
      message: "The full audit history will be erased. This cannot be undone.",
      confirmLabel: "Clear log",
      onConfirm: async () => {
        if (await App.mutate(forge.clearActivity())) {
          App.toast.show({ msg: "Activity log cleared" });
        }
      },
    });
  }

  function truncate(text, n = 40) {
    return text.length > n ? text.slice(0, n - 1) + "\u2026" : text;
  }

  return { deleteWithUndo, deleteProject, clearActivityLog };
})();
