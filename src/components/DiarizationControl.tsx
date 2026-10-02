import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, Loader2, Play, Users, X } from "lucide-react";
import type { ActiveTranscription, Diarization, DiarizationSpeaker, Person } from "../types";
import { formatSpeakerTime, renameTranscriptSpeakers, renderDiarizedTranscript, renderSelfTranscript, speakerSample } from "../lib/diarization";

interface ModelStatus { supported: boolean; ready: boolean; downloading: boolean; totalBytes: number }
interface DownloadProgress { downloaded: number; total: number }

export function DiarizationControl({ noteId, audioFile, data, transcript, people, participantIds, audioRef, onTranscript, onChange, onProcessingChange, onBeforeProcess }: {
  noteId: string;
  audioFile: string;
  data?: Diarization | null;
  transcript: string;
  people: Person[];
  participantIds: string[];
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onTranscript: (text: string) => void;
  onChange: (data: Diarization, text: string, selfText?: string) => Promise<void> | void;
  onProcessingChange: (processing: boolean) => void;
  onBeforeProcess?: () => Promise<void>;
}) {
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [job, setJob] = useState<ActiveTranscription | null>(null);
  const [recording, setRecording] = useState(true);
  const [download, setDownload] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [names, setNames] = useState<Record<number, string>>({});
  const stopAt = useRef<number | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const samples = useMemo(() => new Map((data?.speakers || []).map((speaker) => [speaker.id, speakerSample(data!, speaker.id)])), [data]);
  useEffect(() => { onProcessingChange(busy || job?.noteId === noteId); }, [busy, job, noteId, onProcessingChange]);

  const refresh = useCallback(async () => {
    try { setModel(await invoke<ModelStatus>("diarization_model_status")); }
    catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => {
    setNames(Object.fromEntries((data?.speakers || []).map((speaker) => [speaker.id, speaker.name])));
  }, [data]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const track = (promise: Promise<() => void>) => promise.then((unlisten) => {
      if (disposed) unlisten(); else unlisteners.push(unlisten);
    });
    const refreshRecording = () => invoke("recording_status").then((status) => { if (!disposed) setRecording(!!status); }).catch(() => {});
    const finished = () => { setJob(null); setBusy(false); };
    // Install listeners before querying status so mounting cannot miss a completion.
    Promise.all([
      track(listen<ActiveTranscription>("transcription-progress", ({ payload }) => setJob(payload))),
      track(listen("transcription-finished", finished)),
      track(listen<{ noteId: string; filename: string; diarization: Diarization }>("diarization-finished", ({ payload }) => {
        finished();
        if (payload.noteId === noteId && payload.filename === audioFile) onTranscript(renderDiarizedTranscript(payload.diarization));
      })),
      track(listen<{ noteId: string; filename: string; message: string }>("transcription-error", ({ payload }) => {
        finished();
        if (payload.noteId === noteId && payload.filename === audioFile) setError(payload.message);
      })),
      track(listen<DownloadProgress>("diarization-model-progress", ({ payload }) => setDownload(payload))),
      track(listen("diarization-model-finished", () => { setDownload(null); refresh(); })),
      track(listen<{ message: string }>("diarization-model-error", ({ payload }) => { setDownload(null); setError(payload.message); refresh(); })),
      track(listen("recording-finished", refreshRecording)),
      track(listen("recording-error", refreshRecording)),
    ]).then(async () => {
      if (disposed) return;
      await refresh();
      invoke<ActiveTranscription | null>("transcription_status").then((status) => { if (!disposed) setJob(status); }).catch(() => {});
      refreshRecording();
    });
    window.addEventListener("titus-recording-changed", refreshRecording);
    return () => { disposed = true; unlisteners.forEach((unlisten) => unlisten()); window.removeEventListener("titus-recording-changed", refreshRecording); };
    // onTranscript only changes local state; listeners are keyed to the recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, audioFile, refresh]);

  // Stop the shared player at the end of the example, and pause on unmount.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (stopAt.current !== null && audioRef.current && audioRef.current.currentTime >= stopAt.current) {
        audioRef.current.pause(); stopAt.current = null;
      }
    }, 100);
    return () => { window.clearInterval(timer); if (stopAt.current !== null) audioRef.current?.pause(); stopAt.current = null; };
  }, [audioRef]);

  const start = async () => {
    setError(null); setConfirm(false); setBusy(true);
    try {
      await onBeforeProcess?.();
      await invoke("diarize_audio", { noteId, filename: audioFile });
      const status = await invoke<ActiveTranscription | null>("transcription_status");
      setJob(status);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const downloadModel = async () => {
    setError(null); setDownload({ downloaded: 0, total: modelRef.current?.totalBytes || 0 });
    try { await invoke("download_diarization_model"); }
    catch (e) { setError(String(e)); setDownload(null); }
  };

  const update = async (id: number, patch: Partial<DiarizationSpeaker>) => {
    if (!data) return;
    setError(null);
    const next: Diarization = { ...data, speakers: data.speakers.map((speaker) => speaker.id === id
      ? { ...speaker, ...patch }
      : patch.isSelf ? { ...speaker, isSelf: false } : speaker) };
    const text = renameTranscriptSpeakers(transcript, data, next);
    onTranscript(text);
    try { await onChange(next, text, patch.isSelf !== undefined || next.speakers.some((speaker) => speaker.isSelf) ? renderSelfTranscript(next, text) : undefined); }
    catch (e) { setError(String(e)); }
  };

  const playSample = async (id: number) => {
    if (!data) return;
    const sample = samples.get(id);
    const player = audioRef.current;
    if (!sample || !player) { setError("Aguarde o áudio carregar para ouvir este interlocutor."); return; }
    try {
      player.currentTime = sample.start;
      stopAt.current = Math.min(sample.end, sample.start + 8);
      await player.play();
    } catch (e) { stopAt.current = null; setError(`Não foi possível reproduzir o trecho: ${String(e)}`); }
  };

  const availablePeople = [...people].sort((a, b) => Number(participantIds.includes(b.id)) - Number(participantIds.includes(a.id)) || a.name.localeCompare(b.name));
  const downloading = !!download || !!model?.downloading;
  const disabled = busy || !!job || recording || !model?.ready || downloading;
  return (
    <section className="diarization-control" aria-label="Diarização e interlocutores">
      <div className="diarization-toolbar">
        <Users size={16} />
        <div className="diarization-description">
          <strong>Quem falou?</strong>
          <span>{recording ? "Finalize a gravação para separar as vozes." : "Separe as vozes e identifique os interlocutores. Processamento local."}</span>
        </div>
        {model?.supported === false ? <span>Disponível no macOS.</span> : model && !model.ready ? (
          <button type="button" className="recorder-btn" disabled={downloading} onClick={downloadModel}>
            {downloading ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
            {downloading ? "Baixando modelo…" : `Baixar diarização (${Math.ceil(model.totalBytes / 1024 / 1024)} MB)`}
          </button>
        ) : <button type="button" className="recorder-btn recorder-btn-record" disabled={disabled} onClick={() => {
          if (transcript.trim() || data) setConfirm(true); else start();
        }}><Users size={12} />{data ? "Diarizar novamente" : "Diarizar"}</button>}
      </div>
      {downloading && <div className="diarization-download" role="status">
        {download && download.total > 0 ? `${Math.round(download.downloaded / download.total * 100)}% · ` : ""}Baixando modelo de diarização
        <button type="button" className="recorder-btn" onClick={() => invoke("cancel_diarization_model_download").catch((e) => setError(String(e)))}><X size={12} />Cancelar</button>
      </div>}
      {confirm && <div className="diarization-confirm" role="alert">
        <span>A diarização gera uma nova transcrição e substitui o texto e a identificação atuais.</span>
        <button type="button" className="recorder-btn recorder-btn-record" disabled={disabled} onClick={start}>Diarizar e substituir</button>
        <button type="button" className="recorder-btn" onClick={() => setConfirm(false)}>Voltar</button>
      </div>}
      {error && <p className="diarization-error" role="alert">{error}</p>}
      {data?.filename === audioFile && data.speakers.length > 0 && <details className="diarization-speakers" open>
        <summary>{data.speakers.length} interlocutor(es) · Identifique as vozes</summary>
        <p>Ouça um trecho e informe o nome ou escolha uma pessoa. Os nomes são salvos e aplicados às falas. “Sou eu” ajuda a identificar seus itens de ação.</p>
        {data.speakers.map((speaker) => {
          const sample = samples.get(speaker.id);
          return <div className="diarization-speaker" key={speaker.id}>
            <span className="diarization-speaker-id">{speaker.id + 1}</span>
            <button type="button" className="recorder-btn" onClick={() => playSample(speaker.id)} disabled={!sample} aria-label={`Ouvir interlocutor ${speaker.id + 1}`}><Play size={12} />{sample ? formatSpeakerTime(sample.start) : "Ouvir"}</button>
            <input aria-label={`Nome do interlocutor ${speaker.id + 1}`} value={names[speaker.id] ?? speaker.name} maxLength={120} disabled={!!job || busy}
              onChange={(e) => setNames((previous) => ({ ...previous, [speaker.id]: e.target.value.replace(/[\r\n]/g, " ") }))}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={() => { const name = names[speaker.id]?.trim() || `Interlocutor ${speaker.id + 1}`; if (name !== speaker.name) update(speaker.id, { name, personId: null }); }} />
            <select aria-label={`Pessoa para interlocutor ${speaker.id + 1}`} value={speaker.personId || ""} disabled={!!job || busy} onChange={(e) => {
              const person = people.find((candidate) => candidate.id === e.target.value);
              update(speaker.id, person ? { personId: person.id, name: person.name } : { personId: null });
            }}>
              <option value="">Nome livre</option>
              {availablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}{participantIds.includes(person.id) ? " · participante" : ""}</option>)}
            </select>
            <label><input type="checkbox" checked={speaker.isSelf} disabled={!!job || busy} onChange={(e) => update(speaker.id, { isSelf: e.target.checked })} />Sou eu</label>
          </div>;
        })}
        <p className="diarization-overlap-note">Falas simultâneas aparecem com os dois nomes. A diarização identifica vozes; pode exigir correções manuais.</p>
      </details>}
    </section>
  );
}
