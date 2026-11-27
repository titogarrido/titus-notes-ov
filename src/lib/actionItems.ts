import type { Database, Task } from "../types";

export function approveActionItems(
  db: Database,
  noteId: string,
  selectedIds: readonly string[],
): { database: Database; tasks: Task[] } {
  const note = db.notes.find((item) => item.id === noteId);
  const drafts = note?.actionItemDrafts ?? [];
  const selected = new Set(selectedIds);
  const approved = drafts.filter((item) => selected.has(item.id) && item.include && item.title.trim());
  if (!note || !approved.length) return { database: db, tasks: [] };

  const existingIds = new Set(db.tasks.map((task) => task.id));
  const tasks: Task[] = approved
    .map((item) => ({
      id: `task-${item.id}`,
      title: item.title.trim(),
      completed: false,
      dueDate: item.dueDate,
      projectId: note.projectId,
      personId: item.personId,
      peopleIds: item.peopleIds.length ? item.peopleIds : undefined,
      sourceNoteId: noteId,
    }))
    .filter((task) => !existingIds.has(task.id));
  const approvedIds = new Set(approved.map((item) => item.id));
  const remaining = drafts.filter((item) => !approvedIds.has(item.id));
  return {
    database: {
      ...db,
      notes: db.notes.map((item) =>
        item.id === noteId ? { ...item, actionItemDrafts: remaining.length ? remaining : null } : item,
      ),
      tasks: [...tasks, ...db.tasks],
    },
    tasks,
  };
}
