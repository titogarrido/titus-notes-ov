import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/voiceProfiles.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { VOICE_MODEL, matchVoiceProfiles, enrollVoiceProfile, validVoiceSignature } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const signature = (cosine = 1, duration = 4) => ({ model: VOICE_MODEL, duration, embedding: [cosine, Math.sqrt(1 - cosine * cosine), ...Array(190).fill(0)] });
const person = (id = "ana", sig = signature(), isSelf = false) => ({ id, name: id === "ana" ? "Ana" : id, role: "", email: "", department: "", managerId: null, voiceProfile: { model: VOICE_MODEL, isSelf, updatedAt: "now", samples: [{ ...sig, sourceNoteId: "old", filename: "old.mp3", createdAt: "now" }] } });
const data = (sig = signature()) => ({ filename: "meeting.mp3", model: "Nemotron", speakers: [{ id: 0, name: "Interlocutor 1", isSelf: false, voiceSignature: sig }], turns: [{ start: 0, end: 6, speakerId: 0 }], segments: [] });
const database = () => ({ people: [person()], projects: [], tasks: [], notes: [{ id: "note", title: "Meeting", content: "", date: "", audioFile: "meeting.mp3", peopleIds: ["ana"], projectId: null, diarization: { ...data(), speakers: [{ ...data().speakers[0], personId: "ana", isSelf: true }] } }] });

test("strong voice match applies current name and self identity without mutating profiles", () => {
  const people = [person("ana", signature(), true)]; people[0].name = "Ana atualizado";
  const before = JSON.stringify(people);
  const result = matchVoiceProfiles(data(signature(.95)), people);
  assert.equal(result.speakers[0].name, "Ana atualizado");
  assert.equal(result.speakers[0].personId, "ana");
  assert.equal(result.speakers[0].isSelf, true);
  assert.equal(result.speakers[0].voiceMatch.status, "automatic");
  assert.equal(JSON.stringify(people), before);
});
test("uncertain, short and ambiguous voices require confirmation; unrelated voices remain unnamed", () => {
  for (const [sig, people] of [[signature(.65), [person()]], [signature(1, 2.5), [person()]], [signature(), [person(), person("duplicate")]]]) {
    const speaker = matchVoiceProfiles(data(sig), people).speakers[0];
    assert.equal(speaker.voiceMatch.status, "suggested");
    assert.equal(speaker.personId, undefined);
    assert.equal(speaker.name, "Interlocutor 1");
    assert.equal(speaker.isSelf, false);
  }
  assert.equal(matchVoiceProfiles(data(signature(.2)), [person()]).speakers[0].voiceMatch, undefined);
});
test("missing, incompatible and corrupt signatures are never matched", () => {
  for (const sig of [undefined, { ...signature(), model: "another-model" }, { ...signature(), embedding: Array(192).fill(0) }, { ...signature(), embedding: [NaN, ...Array(191).fill(0)] }, { ...signature(), embedding: [1] }]) {
    assert.equal(validVoiceSignature(sig), false);
    const fixture = data(); fixture.speakers[0].voiceSignature = sig;
    assert.equal(matchVoiceProfiles(fixture, [person()]).speakers[0].personId, undefined);
  }
  const incompatible = person(); incompatible.voiceProfile.model = "another-model";
  assert.equal(matchVoiceProfiles(data(), [incompatible]).speakers[0].voiceMatch, undefined);
  assert.equal(matchVoiceProfiles(data(), []).speakers[0].voiceMatch, undefined);
});
test("simultaneous clusters matching the same person both require review", () => {
  const fixture = data(); fixture.speakers.push({ ...fixture.speakers[0], id: 1, name: "Interlocutor 2" });
  fixture.turns.push({ start: 2, end: 5, speakerId: 1 });
  const result = matchVoiceProfiles(fixture, [person()]);
  assert.deepEqual(result.speakers.map((s) => s.voiceMatch.status), ["suggested", "suggested"]);
  assert.ok(result.speakers.every((s) => !s.personId));
});
test("explicit enrollment persists signatures, caps anchors, replaces duplicate recordings and keeps one self", () => {
  let db = database(); db.people.push(person("tito", signature(), true));
  for (let i = 0; i < 7; i++) {
    const filename = `meeting-${i}.mp3`;
    db.notes[0] = { ...db.notes[0], audioFile: filename, diarization: { ...db.notes[0].diarization, filename } };
    db = enrollVoiceProfile(db, "note", filename, 0, "ana", signature(.9), "later");
  }
  assert.equal(db.people[0].voiceProfile.samples.length, 5);
  assert.equal(db.people[0].voiceProfile.samples[0].filename, "meeting-2.mp3");
  db = enrollVoiceProfile(db, "note", "meeting-6.mp3", 0, "ana", signature(), "latest");
  assert.equal(db.people[0].voiceProfile.samples.length, 5);
  assert.equal(db.people[0].voiceProfile.samples.at(-1).createdAt, "latest");
  assert.equal(db.people[0].voiceProfile.isSelf, true);
  assert.equal(db.people[1].voiceProfile.isSelf, false);
  assert.deepEqual(db.notes[0].diarization.speakers[0].voiceSignature, signature());
  assert.equal(db.notes[0].diarization.speakers[0].voiceMatch, null);
});
test("enrollment results are discarded after note, audio, person or association replacement", () => {
  for (const mutate of [(db) => { db.notes = []; }, (db) => { db.notes[0].audioFile = "new.mp3"; }, (db) => { db.people = []; }, (db) => { db.notes[0].diarization.speakers[0].personId = "other"; }]) {
    const db = database(); mutate(db);
    assert.equal(enrollVoiceProfile(db, "note", "meeting.mp3", 0, "ana", signature(), "later"), db);
  }
  assert.throws(() => enrollVoiceProfile(database(), "note", "meeting.mp3", 0, "ana", { ...signature(), duration: 1 }, "later"), /inválido/);
});
