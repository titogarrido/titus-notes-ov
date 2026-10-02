import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Exercise the actual TypeScript utility without adding a test-runner dependency.
const source = await readFile(new URL("../src/lib/diarization.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { renderDiarizedTranscript, renameTranscriptSpeakers, renderSelfTranscript, speakerSample, formatSpeakerTime } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const fixture = () => ({
  filename: "meeting.mp3", model: "Nemotron 3",
  speakers: [{ id: 0, name: "Interlocutor 1", isSelf: false }, { id: 1, name: "Interlocutor 2", isSelf: false }],
  segments: [
    { start: 1, end: 2, speakerIds: [0], text: "Primeira fala." },
    { start: 2, end: 3, speakerIds: [0, 1], text: "Falas sobrepostas." },
    { start: 4, end: 5, speakerIds: [1], text: "Resposta." },
    { start: 6, end: 7, speakerIds: [], text: "Sem atribuição." },
  ],
  turns: [{ start: 0, end: 10, speakerId: 0 }, { start: 0, end: 4, speakerId: 1 }, { start: 7, end: 10, speakerId: 1 }],
});

test("renaming updates single and overlapping headers while preserving manual edits", () => {
  const before = fixture();
  const after = { ...before, speakers: [{ id: 0, name: "Ana (Cliente)", isSelf: true }, { id: 1, name: "Tito", isSelf: false }] };
  const edited = renderDiarizedTranscript(before).replace("Primeira fala.", "Texto corrigido manualmente: Interlocutor 1.") + "\nObservação pessoal.";
  const text = renameTranscriptSpeakers(edited, before, after);
  assert.match(text, /\[0:01\] \(Ana \(Cliente\)\) Texto corrigido manualmente: Interlocutor 1\./);
  assert.match(text, /\[0:02\] \(Ana \(Cliente\) \+ Tito\) Falas sobrepostas\./);
  assert.match(text, /\[0:06\] \(Não identificado\) Sem atribuição\./);
  assert.ok(text.endsWith("Observação pessoal."));
});

test("self transcript excludes overlaps and unassigned speech", () => {
  const data = fixture(); data.speakers[0].isSelf = true;
  assert.equal(renderSelfTranscript(data), "[0:01] Primeira fala.");
});

test("self transcript uses manual text corrections and continuation lines", () => {
  const data = fixture(); data.speakers[0].isSelf = true;
  const text = renderDiarizedTranscript(data).replace("Primeira fala.", "Fala corrigida.\nMais detalhes.");
  assert.equal(renderSelfTranscript(data, text), "[0:01] Fala corrigida.\nMais detalhes.");
});

test("voice sample removes all overlaps before selecting a clean excerpt", () => {
  assert.deepEqual(speakerSample(fixture(), 0), { start: 4, end: 7, speakerId: 0 });
  assert.equal(speakerSample(fixture(), 7), undefined);
});

test("overlap-only voice still offers a sample and long timestamps format correctly", () => {
  const data = fixture(); data.turns = [{ start: 1, end: 3, speakerId: 0 }, { start: 0, end: 5, speakerId: 1 }];
  assert.deepEqual(speakerSample(data, 0), data.turns[0]);
  assert.equal(formatSpeakerTime(3661.7), "1:01:01");
});
