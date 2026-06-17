import React, { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./RichTextEditor.css";
import { FileText, Sparkles, Mic, PanelRightOpen, PanelRightClose, Volume2, Square, Trash2, Captions, Download, Loader2, X, Check, ListChecks } from "lucide-react";
import { Summary, SummaryTemplate, OllamaSettings } from "../types";
import { SummariesPanel } from "./SummariesPanel";
import { ActionItemsPanel } from "./ActionItemsPanel";
import { NoteSidePanel } from "./lexical/NoteSidePanel";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { TRANSFORMERS } from "@lexical/markdown";
import {
  BeautifulMentionsPlugin,
  createBeautifulMentionNode,
  BeautifulMentionNode,
} from "lexical-beautiful-mentions";
import { useApp } from "../context/AppContext";
import { ToolbarPlugin } from "./lexical/ToolbarPlugin";
import { SlashCommandPlugin } from "./lexical/SlashCommandPlugin";
import { InitialContentPlugin } from "./lexical/InitialContentPlugin";
import { ImageNode } from "./lexical/ImageNode";
import { ImagePastePlugin } from "./lexical/ImagePastePlugin";
import {
  PersonMentionComponent,
  MentionsMenu,
  MentionsMenuItem,
} from "./lexical/MentionComponents";

const [CustomMentionNode, customMentionReplacement] = createBeautifulMentionNode(
  PersonMentionComponent as any,
);
// Keep a reference so unused-import linting is satisfied for the default node.
void BeautifulMentionNode;

// IMPORTANTE: array de triggers estável (referência única). Caso seja recriado
// a cada render do RichTextEditor, o BeautifulMentionsPlugin reinicializa e
// engole o caractere "@" antes do menu aparecer.
const MENTION_TRIGGERS = ["@"];
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { $getRoot, EditorState } from "lexical";

interface RichTextEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  /** Foca o editor automaticamente ao montar. Desligue quando outro campo
   *  (ex. o Nome no formulário de criação) deve receber o foco inicial. */
  autoFocus?: boolean;
  /** Exibe o painel lateral (índice/menções). Desligue em formulários compactos
   *  como a criação de projeto, onde o editor deve ocupar toda a largura. */
  sidePanel?: boolean;
  // Sumários por IA (opcionais — quando ausentes, oculta a aba)
  noteId?: string;
  noteTitle?: string;
  summaries?: Summary[];
  templates?: SummaryTemplate[];
  settings?: OllamaSettings;
  onAddSummary?: (s: Summary) => Promise<void> | void;
  onUpdateSummary?: (s: Summary) => Promise<void> | void;
  onDeleteSummary?: (id: string) => Promise<void> | void;
  // Transcrição (opcional — quando ausente, oculta a aba)
  transcript?: string;
  onTranscriptChange?: (t: string) => void;
  /** Arquivo de áudio em files/audio/ — quando presente, mostra um mini player na aba Transcrição */
  audioFile?: string;
  /** Aba inicial ao montar (ex.: abrir direto na transcrição vinda da busca). */
  initialTab?: "content" | "transcript" | "summaries" | "actions";
  /** Termo buscado — rola/realça até a ocorrência na aba de destino. */
  initialQuery?: string;
}

// ----- Mini player de áudio (usa asset protocol — streaming, sem IPC pesado) -----
//
// Antes carregávamos via `read_audio` (Vec<u8>), mas o IPC do Tauri serializa
// bytes como array JSON de números (~5x maior que o binário), travando a UI em
// mp3s grandes. O asset protocol entrega o arquivo direto via `asset.localhost`
// e o <audio> faz streaming nativo.

const audioPathCache = new Map<string, string>();

async function resolveAudioUrl(filename: string): Promise<string> {
  const cached = audioPathCache.get(filename);
  if (cached) return cached;
  const absPath = await invoke<string>("get_audio_path", { filename });
  const url = convertFileSrc(absPath);
  audioPathCache.set(filename, url);
  return url;
}

const TranscriptAudioPlayer: React.FC<{ filename: string }> = ({ filename }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    resolveAudioUrl(filename)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [filename]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 12px",
        marginBottom: "10px",
        border: "1px solid var(--color-border, #e0e0e0)",
        background: "#f8fafc",
        borderRadius: "8px",
      }}
    >
      <Volume2 size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
      {error ? (
        <span style={{ fontSize: "12px", color: "#cf222e" }}>
          Falha ao carregar áudio: {error}
        </span>
      ) : src ? (
        <audio
          controls
          src={src}
          preload="metadata"
          style={{ flex: 1, height: "32px" }}
        />
      ) : (
        <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          Carregando áudio…
        </span>
      )}
    </div>
  );
};

// ----- Transcrição local (Parakeet TDT v3 via ONNX, on-demand) -----
//
// O trabalho pesado roda no backend Rust; aqui só disparamos o job e
// refletimos progresso/erro via eventos globais `transcription-*`. A
// persistência do texto na nota é feita pelo AppContext (sobrevive à troca
// de tela) — este componente só atualiza a textarea local quando o job
// desta nota termina.

import {
  TranscriptionModelStatus,
  ActiveTranscription,
} from "../types";

const MODEL_LABEL = "Parakeet v3 (~670 MB)";

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

interface ModelDownloadProgress {
  fileIndex: number;
  fileCount: number;
  overallDownloaded: number;
  overallTotal: number;
}

const TranscribeControl: React.FC<{
  noteId: string;
  audioFile: string;
  hasTranscript: boolean;
  onTranscript: (text: string) => void;
}> = ({ noteId, audioFile, hasTranscript, onTranscript }) => {
  const [model, setModel] = useState<TranscriptionModelStatus | null>(null);
  const [job, setJob] = useState<ActiveTranscription | null>(null);
  const [download, setDownload] = useState<ModelDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshModel = useCallback(() => {
    invoke<TranscriptionModelStatus>("transcription_model_status")
      .then(setModel)
      .catch(() => setModel(null));
  }, []);

  // Sincroniza com o backend ao montar — download/transcrição podem estar
  // rodando desde antes do componente existir.
  useEffect(() => {
    refreshModel();
    invoke<ActiveTranscription | null>("transcription_status")
      .then((j) => setJob(j))
      .catch(() => {});
  }, [refreshModel]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      });

    track(
      listen<ActiveTranscription>("transcription-progress", (e) => {
        setJob({ ...e.payload });
      }),
    );
    track(
      listen<{ noteId: string; text: string }>("transcription-finished", (e) => {
        setJob(null);
        setBusy(false);
        if (e.payload.noteId === noteId) {
          onTranscript(e.payload.text);
        }
      }),
    );
    track(
      listen<{ noteId: string; message: string }>("transcription-error", (e) => {
        setJob(null);
        setBusy(false);
        if (e.payload.noteId === noteId) setError(e.payload.message);
      }),
    );
    track(
      listen<ModelDownloadProgress>("transcription-model-progress", (e) => {
        setDownload(e.payload);
      }),
    );
    track(
      listen("transcription-model-finished", () => {
        setDownload(null);
        refreshModel();
      }),
    );
    track(
      listen<{ message: string }>("transcription-model-error", (e) => {
        setDownload(null);
        setError(e.payload.message);
        refreshModel();
      }),
    );
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const startTranscription = async () => {
    setConfirmReplace(false);
    setError(null);
    setBusy(true);
    // Job otimista — o comando retorna na hora (o trabalho roda num worker) e
    // o backend assume via eventos `transcription-progress`.
    setJob({
      noteId,
      filename: audioFile,
      phase: "decoding",
      processedSecs: 0,
      totalSecs: 0,
    });
    try {
      await invoke("transcribe_audio", { noteId, filename: audioFile });
    } catch (e: any) {
      setError(String(e?.message || e));
      setJob(null);
    } finally {
      setBusy(false);
    }
  };

  const startDownload = () => {
    setError(null);
    setDownload({ fileIndex: 0, fileCount: 4, overallDownloaded: 0, overallTotal: 0 });
    invoke("download_transcription_model").catch((e: any) => {
      setError(String(e?.message || e));
      setDownload(null);
    });
  };

  const mine = job?.noteId === noteId;
  const pct =
    job && job.totalSecs > 0
      ? Math.min(100, Math.round((job.processedSecs / job.totalSecs) * 100))
      : 0;
  const dlPct =
    download && download.overallTotal > 0
      ? Math.min(100, Math.round((download.overallDownloaded / download.overallTotal) * 100))
      : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        marginBottom: "10px",
        border: "1px solid var(--color-border, #e0e0e0)",
        background: "#f8fafc",
        borderRadius: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <Captions size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />

        {job && mine ? (
          <>
            <span style={{ fontSize: "12px", fontWeight: 600 }}>
              {job.phase === "decoding"
                ? `Preparando áudio…${job.processedSecs > 0 ? ` ${formatElapsed(Math.floor(job.processedSecs))}` : ""}`
                : `Transcrevendo… ${formatElapsed(Math.floor(job.processedSecs))} / ${formatElapsed(Math.floor(job.totalSecs))}`}
            </span>
            <div
              style={{
                flex: 1,
                minWidth: "60px",
                height: "6px",
                borderRadius: "3px",
                background: "#e5e7eb",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {job.phase === "decoding" ? (
                <div
                  className="transcribe-indeterminate"
                  style={{
                    position: "absolute",
                    width: "30%",
                    height: "100%",
                    borderRadius: "3px",
                    background: "#2563eb",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    borderRadius: "3px",
                    background: "#2563eb",
                    transition: "width 300ms linear",
                  }}
                />
              )}
            </div>
            <button
              type="button"
              className="recorder-btn"
              onClick={() => invoke("cancel_transcription").catch(() => {})}
              title="Cancelar transcrição"
            >
              <X size={12} /> Cancelar
            </button>
          </>
        ) : job && !mine ? (
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            Há uma transcrição em andamento em outra nota — aguarde para transcrever aqui.
          </span>
        ) : download ? (
          <>
            <span style={{ fontSize: "12px", fontWeight: 600 }}>
              Baixando modelo… {formatMB(download.overallDownloaded)}
              {download.overallTotal > 0 ? ` / ${formatMB(download.overallTotal)}` : ""}
            </span>
            <div
              style={{
                flex: 1,
                minWidth: "60px",
                height: "6px",
                borderRadius: "3px",
                background: "#e5e7eb",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${dlPct}%`,
                  height: "100%",
                  borderRadius: "3px",
                  background: "#2563eb",
                  transition: "width 300ms linear",
                }}
              />
            </div>
            <button
              type="button"
              className="recorder-btn"
              onClick={() => invoke("cancel_transcription_model_download").catch(() => {})}
              title="Cancelar download"
            >
              <X size={12} /> Cancelar
            </button>
          </>
        ) : model && !model.ready ? (
          <>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", flex: 1 }}>
              A transcrição roda 100% local com o modelo {MODEL_LABEL}.
            </span>
            <button
              type="button"
              className="recorder-btn"
              onClick={startDownload}
              style={{ whiteSpace: "nowrap" }}
            >
              <Download size={12} /> Baixar modelo
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", flex: 1 }}>
              Gera a transcrição localmente a partir do áudio anexado (Parakeet v3).
            </span>
            {confirmReplace ? (
              <button
                type="button"
                className="recorder-btn recorder-btn-discard"
                onClick={startTranscription}
                disabled={busy}
              >
                Substituir transcrição atual?
              </button>
            ) : (
              <button
                type="button"
                className="recorder-btn recorder-btn-record"
                disabled={busy || !model}
                onClick={() => {
                  if (hasTranscript) setConfirmReplace(true);
                  else startTranscription();
                }}
                style={{ whiteSpace: "nowrap" }}
              >
                {busy ? <Loader2 size={12} className="spin" /> : <Captions size={12} />}{" "}
                Transcrever áudio
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <span style={{ fontSize: "12px", color: "#cf222e" }}>Falha na transcrição: {error}</span>
      )}
    </div>
  );
};

// ----- Gravador de reunião (mic + áudio do sistema → MP3 mono 16 kHz) -----
//
// A captura roda no backend Rust (cpal + ScreenCaptureKit). A nota recebe o
// mp3 via evento global `recording-finished` tratado no AppContext — este
// componente só comanda start/stop e reflete o estado.

interface BackendRecordingStatus {
  filename: string;
  noteId: string;
  elapsedSecs: number;
  systemAudio: boolean;
  warning: string | null;
}

import {
  AUTO_STOP_STORAGE_KEY,
  AUTO_STOP_OPTIONS,
  loadAutoStopSecs,
} from "../lib/recorderPrefs";

function formatElapsed(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Evento DOM local para o MeetingRecorder e o indicador da barra de abas se
// manterem em sincronia sem compartilhar estado React (cada um re-renderiza
// sozinho, sem arrastar o editor junto).
const RECORDING_CHANGED_EVENT = "titus-recording-changed";
const notifyRecordingChanged = () => window.dispatchEvent(new Event(RECORDING_CHANGED_EVENT));

/// Controle compacto de gravação na barra de abas — permite iniciar e parar a
/// gravação sem sair da aba Conteúdo (onde as notas são tomadas durante a
/// reunião) e mostra o andamento em qualquer aba. A aba Transcrição mantém o
/// gravador completo (medidor de nível, descarte, auto-stop).
const RecordingTabControl: React.FC<{
  noteId: string;
  /** Esconde botão/avisos quando o gravador completo já está visível (aba Transcrição) */
  hideStart?: boolean;
  onOpenTranscript?: () => void;
}> = ({ noteId, hideStart, onOpenTranscript }) => {
  const { db } = useApp();
  const [state, setState] = useState<"idle" | "mine" | "other" | "busy">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    invoke<BackendRecordingStatus | null>("recording_status")
      .then((s) => {
        if (!s) {
          setState((st) => (st === "busy" ? st : "idle"));
          return;
        }
        setElapsed(s.elapsedSecs);
        setState(s.noteId === noteId ? "mine" : "other");
      })
      .catch(() => setState("idle"));
  }, [noteId]);

  useEffect(() => {
    refresh();
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const onChanged = () => refresh();
    window.addEventListener(RECORDING_CHANGED_EVENT, onChanged);
    [
      listen<{ noteId: string; reason: string }>("recording-finished", (e) => {
        refresh();
        if (e.payload.noteId === noteId) {
          setJustSaved(true);
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setJustSaved(false), 8000);
        }
      }),
      listen("recording-error", onChanged),
    ].forEach((p) =>
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      }),
    );
    return () => {
      disposed = true;
      window.removeEventListener(RECORDING_CHANGED_EVENT, onChanged);
      unlisteners.forEach((u) => u());
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [refresh, noteId]);

  useEffect(() => {
    if (state !== "mine" && state !== "other") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(async () => {
    setError(null);
    setJustSaved(false);
    setState("busy");
    try {
      await invoke("start_recording", {
        noteId,
        autoStopSecs: loadAutoStopSecs(),
        systemAudio: true,
        live: db.transcriptionMode === "realtime",
      });
      setElapsed(0);
      setState("mine");
    } catch (e: any) {
      setError(String(e?.message || e));
      setState("idle");
    } finally {
      notifyRecordingChanged();
    }
  }, [noteId]);

  // ⌘⇧R inicia a gravação de onde o usuário estiver (só inicia — parar por
  // atalho poderia encerrar uma reunião sem querer, e gravação não retoma).
  const startRef = useRef(start);
  startRef.current = start;
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        if (stateRef.current === "idle") void startRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (state === "mine" || state === "other") {
    return (
      <span
        className="recording-tab-indicator"
        title={
          state === "mine"
            ? "Gravação em andamento nesta nota (controles completos na aba Transcrição)"
            : "Há uma gravação em andamento em outra nota"
        }
      >
        <span className="recorder-pulse-dot" style={{ width: 8, height: 8 }} />
        {state === "mine" ? (
          <>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatElapsed(elapsed)}</span>
            <button
              type="button"
              className="recording-tab-stop"
              title="Parar e salvar a gravação"
              onClick={() => {
                invoke("stop_recording")
                  .catch(() => {})
                  .finally(notifyRecordingChanged);
              }}
            >
              <Square size={9} fill="currentColor" />
            </button>
          </>
        ) : (
          <span>gravando em outra nota</span>
        )}
      </span>
    );
  }

  if (hideStart) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {error && (
        <span className="recording-tab-error" title={error}>
          Falha ao gravar: {error}
        </span>
      )}
      {justSaved && !error && (
        <button
          type="button"
          className="recording-tab-saved"
          onClick={onOpenTranscript}
          title="Gravação anexada à nota — ver na aba Transcrição"
        >
          <Check size={11} /> Gravação salva
        </button>
      )}
      <button
        type="button"
        className="recording-tab-record"
        onClick={() => void start()}
        disabled={state === "busy"}
        title="Gravar reunião nesta nota — mic + áudio do sistema (⌘⇧R)"
      >
        <Mic size={12} /> {state === "busy" ? "Aguarde…" : "Gravar"}
      </button>
    </span>
  );
};

const MeetingRecorder: React.FC<{ noteId: string }> = ({ noteId }) => {
  const { db } = useApp();
  const [state, setState] = useState<"idle" | "recording" | "other" | "busy">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [maxLevel, setMaxLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [systemAudio, setSystemAudio] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [autoStopSecs, setAutoStopSecs] = useState<number>(loadAutoStopSecs);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Sincroniza com o backend ao montar — a gravação continua viva mesmo se o
  // usuário trocar de aba/nota e voltar.
  useEffect(() => {
    let cancelled = false;
    invoke<BackendRecordingStatus | null>("recording_status")
      .then((s) => {
        if (cancelled || !s) return;
        setElapsed(s.elapsedSecs);
        setSystemAudio(s.systemAudio);
        setWarning(s.warning);
        setState(s.noteId === noteId ? "recording" : "other");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // Re-sincroniza quando a gravação é iniciada/parada por outro controle
  // (botão da barra de abas, atalho ⌘⇧R) com este componente já montado.
  useEffect(() => {
    const sync = () => {
      invoke<BackendRecordingStatus | null>("recording_status")
        .then((s) => {
          if (!s) {
            setState((st) => (st === "busy" ? st : "idle"));
            return;
          }
          setElapsed(s.elapsedSecs);
          setSystemAudio(s.systemAudio);
          setWarning(s.warning);
          setState(s.noteId === noteId ? "recording" : "other");
        })
        .catch(() => {});
    };
    window.addEventListener(RECORDING_CHANGED_EVENT, sync);
    return () => window.removeEventListener(RECORDING_CHANGED_EVENT, sync);
  }, [noteId]);

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state !== "recording") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<{ level: number }>("recording-level", (e) => {
      setLevel(e.payload.level);
      setMaxLevel((m) => Math.max(m, e.payload.level));
    }).then((u) => {
      if (disposed) u();
      else unlisten = u;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [state]);

  // Fim/erro da gravação: sempre ativos — o auto-stop pode disparar a qualquer
  // momento e o evento pode chegar depois do invoke de stop resolver.
  // O AppContext anexa o mp3 à nota; aqui só refletimos o estado na UI.
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      p.then((u) => {
        if (disposed) u();
        else unlisteners.push(u);
      });
    track(
      listen<{ noteId: string; reason: string }>("recording-finished", (e) => {
        if (e.payload.noteId !== noteId) return;
        setState("idle");
        setSavedNotice(
          e.payload.reason === "auto"
            ? "Gravação encerrada automaticamente (silêncio detectado) e anexada à nota."
            : e.payload.reason === "meeting"
            ? "Reunião encerrada — gravação salva e anexada à nota."
            : "Gravação salva e anexada à nota.",
        );
      }),
    );
    track(
      listen<{ noteId: string; message: string }>("recording-error", (e) => {
        if (e.payload.noteId !== noteId) return;
        setState("idle");
        setError(e.payload.message);
      }),
    );
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
  }, [noteId]);

  const start = async () => {
    setError(null);
    setSavedNotice(null);
    setState("busy");
    try {
      const status = await invoke<BackendRecordingStatus>("start_recording", {
        noteId,
        autoStopSecs,
        systemAudio: true,
        live: db.transcriptionMode === "realtime",
      });
      setElapsed(0);
      setLevel(0);
      setMaxLevel(0);
      setConfirmDiscard(false);
      setSystemAudio(status.systemAudio);
      setWarning(status.warning);
      setState("recording");
      notifyRecordingChanged();
    } catch (e: any) {
      setError(String(e?.message || e));
      setState("idle");
    }
  };

  const stopAndSave = async () => {
    setState("busy");
    try {
      await invoke("stop_recording");
      setState("idle");
    } catch (e: any) {
      // Pode já ter sido finalizada pelo auto-stop — o evento cuida do resto
      setState("idle");
      if (!String(e?.message || e).includes("Nenhuma gravação")) {
        setError(String(e?.message || e));
      }
    } finally {
      notifyRecordingChanged();
    }
  };

  const discard = async () => {
    setConfirmDiscard(false);
    setState("busy");
    try {
      await invoke("cancel_recording");
    } catch {
      // já encerrada — segue
    }
    setState("idle");
    notifyRecordingChanged();
  };

  const changeAutoStop = (v: number) => {
    setAutoStopSecs(v);
    localStorage.setItem(AUTO_STOP_STORAGE_KEY, String(v));
  };

  const showMicHint = state === "recording" && elapsed >= 4 && maxLevel < 0.01;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        marginBottom: "10px",
        border: "1px solid var(--color-border, #e0e0e0)",
        background: state === "recording" ? "#fff5f5" : "#f8fafc",
        borderRadius: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        {state === "recording" ? (
          <>
            <span className="recorder-pulse-dot" />
            <span style={{ fontSize: "13px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {formatElapsed(elapsed)}
            </span>
            <span className="recorder-source-badge" title={
              systemAudio
                ? "Capturando o microfone e o áudio do sistema (participantes remotos)"
                : "Capturando apenas o microfone"
            }>
              {systemAudio ? "mic + sistema" : "só microfone"}
            </span>
            <div
              style={{
                flex: 1,
                minWidth: "60px",
                height: "6px",
                borderRadius: "3px",
                background: "#e5e7eb",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round(level * 140))}%`,
                  height: "100%",
                  borderRadius: "3px",
                  background: "#dc2626",
                  transition: "width 120ms linear",
                }}
              />
            </div>
            <button type="button" className="recorder-btn recorder-btn-stop" onClick={stopAndSave}>
              <Square size={12} fill="currentColor" /> Parar e salvar
            </button>
            {confirmDiscard ? (
              <button type="button" className="recorder-btn recorder-btn-discard" onClick={discard}>
                Confirmar descarte?
              </button>
            ) : (
              <button
                type="button"
                className="recorder-btn"
                onClick={() => setConfirmDiscard(true)}
                title="Descartar gravação"
              >
                <Trash2 size={12} /> Descartar
              </button>
            )}
          </>
        ) : state === "other" ? (
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            <Mic size={12} style={{ verticalAlign: "-2px" }} /> Há uma gravação em andamento em
            outra nota — finalize-a antes de gravar aqui.
          </span>
        ) : (
          <>
            <button
              type="button"
              className="recorder-btn recorder-btn-record"
              onClick={start}
              disabled={state === "busy"}
            >
              <Mic size={13} /> {state === "busy" ? "Aguarde…" : "Gravar reunião"}
            </button>
            <select
              className="recorder-select"
              value={autoStopSecs}
              onChange={(e) => changeAutoStop(Number(e.target.value))}
              title="Encerra e salva sozinho quando a reunião termina"
            >
              {AUTO_STOP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              mic + áudio do sistema · MP3 mono 16 kHz · ~14 MB/hora
            </span>
          </>
        )}
      </div>
      {state === "recording" && autoStopSecs > 0 && (
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
          Para sozinha após {Math.round(autoStopSecs / 60)} min de silêncio contínuo.
        </span>
      )}
      {state === "recording" && warning && (
        <span style={{ fontSize: "11px", color: "#b45309" }}>
          Gravando só o microfone — {warning}
        </span>
      )}
      {showMicHint && (
        <span style={{ fontSize: "11px", color: "#b45309" }}>
          Nenhum sinal captado — verifique a permissão do microfone em Ajustes do Sistema →
          Privacidade e Segurança → Microfone.
        </span>
      )}
      {savedNotice && state === "idle" && (
        <span style={{ fontSize: "12px", color: "#15803d" }}>{savedNotice}</span>
      )}
      {error && (
        <span style={{ fontSize: "12px", color: "#cf222e" }}>Falha na gravação: {error}</span>
      )}
    </div>
  );
};

// ------- helpers de extração a partir do JSON do Lexical -------

interface ExtractedHeading {
  level: 1 | 2 | 3;
  text: string;
  index: number;
}

function extractTextFromNode(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.children)) return node.children.map(extractTextFromNode).join("");
  return "";
}

function extractHeadings(value: string): ExtractedHeading[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const out: ExtractedHeading[] = [];
    if (!parsed?.root?.children) return [];
    parsed.root.children.forEach((child: any, idx: number) => {
      if (child?.type === "heading") {
        const tag = String(child.tag || "h1");
        const lvl = Math.min(3, Math.max(1, Number(tag.slice(1)) || 1)) as 1 | 2 | 3;
        const text = extractTextFromNode(child).trim();
        out.push({ level: lvl, text, index: idx });
      }
    });
    return out;
  } catch {
    return [];
  }
}

// Extrai todos os IDs candidatos a menção do JSON do Lexical.
// Olha em múltiplas localizações (`data.id`, `id`, `__data.id`) porque o
// custom mention node nem sempre serializa o `data` no mesmo formato.
function extractMentionIds(value: string): { id: string; value?: string; kind?: string }[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const out: { id: string; value?: string; kind?: string }[] = [];
    const walk = (n: any) => {
      if (!n) return;
      if (
        n.type === "beautifulMention" ||
        n.type === "custom-beautifulMention" ||
        n.type === "mention"
      ) {
        const data = n.data || n.__data || {};
        const id = data.id ?? n.id ?? n.__id;
        const kind = data.kind ?? n.kind;
        const val = n.value ?? n.__value;
        if (id != null) out.push({ id: String(id), value: val, kind });
      }
      if (Array.isArray(n.children)) n.children.forEach(walk);
    };
    if (parsed?.root) walk(parsed.root);
    return out;
  } catch {
    return [];
  }
}

function countWords(value: string): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    const text = extractTextFromNode(parsed.root || parsed);
    return text.trim() ? text.trim().split(/\s+/).length : 0;
  } catch {
    return (value.trim() ? value.trim().split(/\s+/).length : 0);
  }
}

function relativeTime(d: Date | null): string {
  if (!d) return "—";
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 5) return "agora";
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  return d.toLocaleDateString("pt-BR");
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = "Digite algo... (use @ para mencionar pessoas, / para comandos)",
  autoFocus = true,
  sidePanel = true,
  noteTitle,
  summaries,
  templates,
  settings,
  onAddSummary,
  onUpdateSummary,
  onDeleteSummary,
  transcript,
  onTranscriptChange,
  audioFile,
  noteId = "",
  initialTab,
  initialQuery,
}) => {
  const { db, setCurrentView, setSelectedEntityId, liveTranscribingNoteId } = useApp();
  const isReadyRef = useRef(false);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  // Esta nota está sendo transcrita ao vivo agora?
  const liveActive = !!noteId && liveTranscribingNoteId === noteId;
  const summariesEnabled =
    !!summaries && !!templates && !!settings && !!onAddSummary && !!onUpdateSummary && !!onDeleteSummary;
  const transcriptEnabled = !!onTranscriptChange;
  // Itens de ação dependem do mesmo contexto de IA dos sumários (settings + nota).
  const actionItemsEnabled = summariesEnabled && !!noteId;
  // Aba inicial: respeita `initialTab` (ex.: busca abriu na transcrição), mas só
  // se a aba correspondente estiver habilitada; senão cai no conteúdo.
  const [tab, setTab] = useState<"content" | "transcript" | "summaries" | "actions">(() => {
    if (initialTab === "transcript" && transcriptEnabled) return "transcript";
    if (initialTab === "summaries" && summariesEnabled) return "summaries";
    if (initialTab === "actions" && actionItemsEnabled) return "actions";
    return "content";
  });

  // Quando `initialTab` muda (ex.: busca pediu transcrição na MESMA nota já
  // aberta, sem remontar), troca a aba ativa se ela estiver habilitada.
  useEffect(() => {
    if (!initialTab) return;
    if (initialTab === "transcript" && transcriptEnabled) setTab("transcript");
    else if (initialTab === "summaries" && summariesEnabled) setTab("summaries");
    else if (initialTab === "actions" && actionItemsEnabled) setTab("actions");
    else if (initialTab === "content") setTab("content");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // Transcrição ao vivo: reflete no textarea o transcript que cresce no banco,
  // sem atropelar uma edição manual (só sincroniza se o campo não está focado).
  useEffect(() => {
    if (!liveActive) return;
    if (document.activeElement !== transcriptRef.current) {
      setLocalTranscript(transcript || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, liveActive]);

  // "Latch" do termo da busca p/ revelar na transcrição: capturado durante o
  // render (antes do pai limpar o estado global) e preservado até a aba montar.
  const revealQueryRef = useRef<string | null>(null);
  if (initialQuery && initialTab === "transcript") {
    revealQueryRef.current = initialQuery;
  }

  // Ao abrir/entrar na aba Transcrição com um termo pendente, foca, seleciona e
  // rola até a primeira ocorrência (estimativa por linha — boa o suficiente).
  useEffect(() => {
    if (tab !== "transcript") return;
    const q = revealQueryRef.current;
    if (!q) return;
    const ta = transcriptRef.current;
    if (!ta) return;
    const idx = localTranscript.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) {
      revealQueryRef.current = null;
      return;
    }
    const raf = requestAnimationFrame(() => {
      ta.focus();
      try {
        ta.setSelectionRange(idx, idx + q.length);
      } catch {
        /* navegadores antigos */
      }
      const line = localTranscript.slice(0, idx).split("\n").length - 1;
      const cs = getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 18;
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
      revealQueryRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [showSidePanel, setShowSidePanel] = useState(true);
  // Estado local da transcrição: a persistência é debounced no NotesView, e
  // uma textarea controlada pelo db "engoliria" teclas até o flush. O
  // componente remonta por nota (key={note.id}), então iniciar do prop basta.
  const [localTranscript, setLocalTranscript] = useState(transcript || "");
  // Guarda em ref para NÃO causar re-render a cada keystroke (isso quebrava o
  // plugin de menção "@" que recebia novas referências de props e resetava
  // o estado interno). O display é atualizado por um tick.
  const lastSavedAtRef = useRef<Date | null>(null);
  const [, setTick] = useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // memoiza derivações pesadas
  const headings = useMemo(() => extractHeadings(value), [value]);
  const mentionedIds = useMemo(() => {
    const rawMentions = extractMentionIds(value);
    const peopleById = new Map(db.people.map((p) => [p.id, p]));
    const peopleByName = new Map(db.people.map((p) => [p.name.toLowerCase(), p]));
    const matched = new Set<string>();
    rawMentions.forEach((m) => {
      // Ignora mentions explicitamente de outro tipo
      if (m.kind && m.kind !== "person") return;
      if (peopleById.has(m.id)) {
        matched.add(m.id);
        return;
      }
      // Fallback: bate pelo nome (mention sem `data.id` mas com `value`)
      if (m.value) {
        const byName = peopleByName.get(m.value.toLowerCase());
        if (byName) matched.add(byName.id);
      }
    });
    return Array.from(matched);
  }, [value, db.people]);
  const wordCount = useMemo(() => countWords(value), [value]);
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  // Configuração inicial do editor — MEMOIZADA com [] para garantir referência
  // estável. Caso contrário o LexicalComposer pode reinicializar o editor
  // (incluindo o plugin de menção) a cada render do RichTextEditor.
  const initialConfig = useMemo(
    () => ({
      namespace: "RichTextEditor",
      theme: {
        paragraph: "editor-paragraph",
        heading: {
          h1: "editor-heading-h1",
          h2: "editor-heading-h2",
          h3: "editor-heading-h3",
        },
        list: {
          ol: "editor-list-ol",
          ul: "editor-list-ul",
          listitem: "editor-list-item",
        },
        code: "editor-code",
        quote: "editor-quote",
        link: "editor-link",
        ltr: "editor-ltr",
        rtl: "editor-rtl",
        text: {
          bold: "editor-text-bold",
          italic: "editor-text-italic",
          underline: "editor-text-underline",
          strikethrough: "editor-text-strikethrough",
          code: "editor-text-code",
        },
      },
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        LinkNode,
        CustomMentionNode,
        customMentionReplacement,
        ImageNode,
      ],
      onError: (error: Error) => {
        console.error("Lexical Error:", error);
      },
      editorState: undefined,
    }),
    [],
  );

  // Refs para o handleMentionSearch ter dep estável mas dados sempre frescos
  const peopleRef = useRef(db.people);
  const projectsRef = useRef(db.projects);
  const notesRef = useRef(db.notes);
  peopleRef.current = db.people;
  projectsRef.current = db.projects;
  notesRef.current = db.notes;

  // Helper: gera sugestões de data baseado na query
  const buildDateSuggestions = useCallback((query: string) => {
    const today = new Date();
    const fmt = (d: Date) =>
      d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const items: { value: string; id: string; kind: string; sub: string }[] = [
      {
        value: fmt(today),
        id: today.toISOString().slice(0, 10),
        kind: "date",
        sub: "Hoje",
      },
      {
        value: fmt(new Date(today.getTime() + 86400000)),
        id: new Date(today.getTime() + 86400000).toISOString().slice(0, 10),
        kind: "date",
        sub: "Amanhã",
      },
      {
        value: fmt(new Date(today.getTime() + 7 * 86400000)),
        id: new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10),
        kind: "date",
        sub: "Em 7 dias",
      },
      {
        value: fmt(new Date(today.getTime() + 30 * 86400000)),
        id: new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10),
        kind: "date",
        sub: "Em 30 dias",
      },
    ];
    const q = (query || "").toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.value.includes(q) || it.sub.toLowerCase().includes(q),
    );
  }, []);

  const handleMentionSearch = useCallback(
    async (trigger: string, query?: string | null) => {
      if (trigger !== "@") return [];
      const q = (query || "").toLowerCase();

      const people = peopleRef.current
        .filter((p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
        .map((p) => ({
          value: p.name,
          id: p.id,
          kind: "person" as const,
          sub: p.role || "",
        }));

      const projects = projectsRef.current
        .filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => ({
          value: p.name,
          id: p.id,
          kind: "project" as const,
          sub: `${p.peopleIds.length} pessoa(s)`,
        }));

      const notes = notesRef.current
        .filter((n) => (n.title || "").toLowerCase().includes(q))
        .slice(0, 20)
        .map((n) => ({
          value: n.title || "Sem título",
          id: n.id,
          kind: "note" as const,
          sub: n.date || "",
        }));

      const dates = buildDateSuggestions(q);

      return [...people, ...projects, ...notes, ...dates];
    },
    [buildDateSuggestions],
  );

  // onChange também via ref pra ter callback estável
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleEditorChange = useCallback((editorState: EditorState) => {
    if (!isReadyRef.current) return;
    editorState.read(() => {
      const root = $getRoot();
      void root.getTextContent();
      const json = JSON.stringify(editorState.toJSON());
      onChangeRef.current(json);
      lastSavedAtRef.current = new Date();
    });
  }, []);

  // Navegação para links do side panel
  const handleOpenNote = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("notas");
  };
  const handleOpenPerson = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("pessoas");
  };
  const handleOpenTask = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("tarefas");
  };
  const handleOpenProject = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("projetos");
  };

  const handleJumpToHeading = (index: number) => {
    // rola até o nth bloco de root no editor-input
    const root = document.querySelector(".editor-input");
    if (!root) return;
    const children = root.children;
    if (index >= 0 && index < children.length) {
      (children[index] as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Mostra side panel só na aba de conteúdo (e quando habilitado pelo pai)
  const showPanelHere = sidePanel && showSidePanel && tab === "content";
  // Usado pra detectar contexto de "tem painel" na hora de mostrar o botão de toggle
  const hasContextPanel = sidePanel && (summariesEnabled || transcriptEnabled || !!noteId);

  return (
    <div className="rich-text-editor-container">
      {(summariesEnabled || transcriptEnabled) && (
        <div className="editor-tabs">
          <button
            type="button"
            className={`editor-tab ${tab === "content" ? "active" : ""}`}
            onClick={() => setTab("content")}
          >
            <FileText size={14} /> <span>Conteúdo</span>
          </button>
          {transcriptEnabled && (
            <button
              type="button"
              className={`editor-tab ${tab === "transcript" ? "active" : ""}`}
              onClick={() => setTab("transcript")}
            >
              <Mic size={14} /> <span>Transcrição</span>
              {transcript && transcript.trim().length > 0 && (
                <span className="editor-tab-badge">●</span>
              )}
            </button>
          )}
          {summariesEnabled && (
            <button
              type="button"
              className={`editor-tab ${tab === "summaries" ? "active" : ""}`}
              onClick={() => setTab("summaries")}
            >
              <Sparkles size={14} /> <span>Sumários</span>
              {summaries && summaries.length > 0 && (
                <span className="editor-tab-badge">{summaries.length}</span>
              )}
            </button>
          )}
          {actionItemsEnabled && (
            <button
              type="button"
              className={`editor-tab ${tab === "actions" ? "active" : ""}`}
              onClick={() => setTab("actions")}
            >
              <ListChecks size={14} /> <span>Ações</span>
            </button>
          )}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
            {noteId && (
              <RecordingTabControl
                noteId={noteId}
                hideStart={tab === "transcript"}
                onOpenTranscript={() => setTab("transcript")}
              />
            )}
            {hasContextPanel && tab === "content" && (
              <button
                type="button"
                className="editor-tab editor-tab-toggle"
                onClick={() => setShowSidePanel((v) => !v)}
                title={showSidePanel ? "Esconder painel" : "Mostrar painel"}
              >
                {showSidePanel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
            )}
          </div>
        </div>
      )}

      {summariesEnabled && tab === "summaries" && (
        <SummariesPanel
          noteTitle={noteTitle || ""}
          noteContent={value}
          transcript={localTranscript}
          summaries={summaries!}
          templates={templates!}
          settings={settings!}
          onAddSummary={onAddSummary!}
          onUpdateSummary={onUpdateSummary!}
          onDeleteSummary={onDeleteSummary!}
        />
      )}

      {actionItemsEnabled && tab === "actions" && (
        <ActionItemsPanel
          noteId={noteId}
          noteTitle={noteTitle || ""}
          noteContent={value}
          transcript={localTranscript}
          summaries={summaries!}
          settings={settings!}
        />
      )}

      {transcriptEnabled && tab === "transcript" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "16px 24px",
            background: "white",
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                <Mic size={16} /> Transcrição da reunião
                {liveActive && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "#fdecec",
                      color: "#cf222e",
                    }}
                  >
                    <span className="live-dot" /> ao vivo
                  </span>
                )}
              </h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--color-text-muted)" }}>
                Cole aqui o texto bruto da transcrição. Será usado como fonte primária ao gerar sumários.
              </p>
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {localTranscript.length.toLocaleString("pt-BR")} caracteres
            </div>
          </div>
          {noteId && <MeetingRecorder noteId={noteId} />}
          {audioFile && <TranscriptAudioPlayer filename={audioFile} />}
          {noteId && audioFile && (
            <TranscribeControl
              noteId={noteId}
              audioFile={audioFile}
              hasTranscript={localTranscript.trim().length > 0}
              onTranscript={(t) => setLocalTranscript(t)}
            />
          )}
          <textarea
            ref={transcriptRef}
            value={localTranscript}
            onChange={(e) => {
              setLocalTranscript(e.target.value);
              onTranscriptChange?.(e.target.value);
            }}
            placeholder="Cole a transcrição da reunião aqui..."
            spellCheck={false}
            style={{
              flex: 1,
              width: "100%",
              minHeight: 0,
              padding: "14px 16px",
              border: "1px solid var(--color-border, #e0e0e0)",
              borderRadius: "8px",
              fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
              fontSize: "13px",
              lineHeight: 1.55,
              resize: "none",
              outline: "none",
              background: "#fafbfc",
              color: "#212529",
            }}
          />
        </div>
      )}

      <div
        style={{
          display: (summariesEnabled || transcriptEnabled) && tab !== "content" ? "none" : "flex",
          flexDirection: "row",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <LexicalComposer initialConfig={initialConfig}>
            <div className="editor-wrapper">
              <ToolbarPlugin />

              <div className="editor-inner">
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      className="editor-input"
                      aria-placeholder={placeholder}
                      placeholder={
                        <div className="editor-placeholder">{placeholder}</div>
                      }
                    />
                  }
                  ErrorBoundary={LexicalErrorBoundary}
                />

                <HistoryPlugin />
                {autoFocus && <AutoFocusPlugin />}
                <ListPlugin />
                <LinkPlugin />
                <MarkdownShortcutPlugin transformers={TRANSFORMERS} />

                <BeautifulMentionsPlugin
                  triggers={MENTION_TRIGGERS}
                  onSearch={handleMentionSearch}
                  menuItemLimit={10}
                  insertOnBlur={false}
                  showMentionsOnDelete={true}
                  menuComponent={MentionsMenu as any}
                  menuItemComponent={MentionsMenuItem as any}
                  menuAnchorClassName="beautiful-mentions-menu-anchor"
                />

                <SlashCommandPlugin />

                <ImagePastePlugin />

                <InitialContentPlugin
                  value={value}
                  onReady={() => {
                    isReadyRef.current = true;
                  }}
                />

                {/* ignoreSelectionChange: sem isso, cada movimento de cursor
                    serializava o documento inteiro e disparava um save */}
                <OnChangePlugin onChange={handleEditorChange} ignoreSelectionChange />
              </div>
            </div>
          </LexicalComposer>

          {/* Footer com métricas */}
          <div className="editor-footer">
            <span className="editor-footer-saved">
              <span className="editor-footer-dot" />
              {lastSavedAtRef.current
                ? `Salvo ${relativeTime(lastSavedAtRef.current)}`
                : "Aguardando edição"}
            </span>
            <span>·</span>
            <span>{wordCount.toLocaleString("pt-BR")} palavras</span>
            <span>·</span>
            <span>{readingMinutes} min de leitura</span>
            {headings.length > 0 && (
              <>
                <span>·</span>
                <span>{headings.length} seç{headings.length === 1 ? "ão" : "ões"}</span>
              </>
            )}
          </div>
        </div>

        {/* Side panel */}
        {showPanelHere && (
          <NoteSidePanel
            headings={headings}
            mentionedPeopleIds={mentionedIds}
            noteId={noteId}
            noteTitle={noteTitle || ""}
            allNotes={db.notes}
            allPeople={db.people}
            allProjects={db.projects}
            allTasks={db.tasks}
            onOpenNote={handleOpenNote}
            onOpenPerson={handleOpenPerson}
            onOpenTask={handleOpenTask}
            onOpenProject={handleOpenProject}
            onJumpToHeading={handleJumpToHeading}
          />
        )}
      </div>
    </div>
  );
};

// Made with Bob
