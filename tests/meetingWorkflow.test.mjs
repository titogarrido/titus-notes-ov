import assert from "node:assert/strict";
import test from "node:test";
import { approveActionItems } from "../src/lib/actionItems.ts";
import { toDateOnly } from "../src/lib/dates.ts";

test("a note created after 21h in São Paulo keeps the local date", () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "America/Sao_Paulo";
    assert.equal(toDateOnly(new Date("2026-11-28T00:30:00Z")), "2026-11-27");
    assert.equal(toDateOnly(new Date("2026-11-28T03:00:00Z")), "2026-11-28");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("approval links the task to its note and keeps the remaining drafts", () => {
  const approved = { id: "a", include: true, title: " Enviar ata ", personId: "ana", peopleIds: ["bia"], dueDate: "2026-11-27", mine: true };
  const deferred = { ...approved, id: "b", include: false, title: "Agendar retorno" };
  const unselected = { ...approved, id: "c", title: "Preparar material" };
  const note = { id: "meeting", projectId: "project", actionItemDrafts: [approved, deferred, unselected] };
  const initial = { notes: [note], tasks: [] };

  const result = approveActionItems(initial, note.id, ["a", "b"]);
  assert.deepEqual(result.database.notes[0].actionItemDrafts, [deferred, unselected]);
  assert.deepEqual(result.database.tasks, [{
    id: "task-a",
    title: "Enviar ata",
    completed: false,
    dueDate: "2026-11-27",
    projectId: "project",
    personId: "ana",
    peopleIds: ["bia"],
    sourceNoteId: note.id,
  }]);
  assert.deepEqual(initial.notes[0].actionItemDrafts, [approved, deferred, unselected]);
  assert.equal(approveActionItems(result.database, note.id, ["a"]).database, result.database);
});

test("retry removes a draft already converted without creating a duplicate task", () => {
  const draft = { id: "a", include: true, title: "Enviar ata", personId: null, peopleIds: [], dueDate: "", mine: true };
  const task = { id: "task-a", sourceNoteId: "meeting" };
  const database = { notes: [{ id: "meeting", projectId: null, actionItemDrafts: [draft] }], tasks: [task] };
  const result = approveActionItems(database, "meeting", ["a"]);
  assert.deepEqual(result.tasks, []);
  assert.deepEqual(result.database.tasks, [task]);
  assert.equal(result.database.notes[0].actionItemDrafts, null);
});
