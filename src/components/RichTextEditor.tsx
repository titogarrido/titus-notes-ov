import React, { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import "./RichTextEditor.css";
import { FileText, Sparkles, Mic, PanelRightOpen, PanelRightClose, Volume2 } from "lucide-react";
import { Summary, SummaryTemplate, OllamaSettings } from "../types";
import { SummariesPanel } from "./SummariesPanel";
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
  // Sumários por IA (opcionais — quando ausentes, oculta a aba)
  noteId?: string;
  noteTitle?: string;
  summaries?: Summary[];
  templates?: SummaryTemplate[];
  settings?: OllamaSettings;
  onAddSummary?: (s: Summary) => Promise<void> | void;
  onDeleteSummary?: (id: string) => Promise<void> | void;
  // Transcrição (opcional — quando ausente, oculta a aba)
  transcript?: string;
  onTranscriptChange?: (t: string) => void;
  /** Arquivo de áudio em files/audio/ — quando presente, mostra um mini player na aba Transcrição */
  audioFile?: string;
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
      if (n.type === "beautifulMention" || n.type === "mention") {
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
  noteTitle,
  summaries,
  templates,
  settings,
  onAddSummary,
  onDeleteSummary,
  transcript,
  onTranscriptChange,
  audioFile,
  noteId = "",
}) => {
  const { db, setCurrentView, setSelectedEntityId } = useApp();
  const isReadyRef = useRef(false);
  const summariesEnabled =
    !!summaries && !!templates && !!settings && !!onAddSummary && !!onDeleteSummary;
  const transcriptEnabled = !!onTranscriptChange;
  const [tab, setTab] = useState<"content" | "transcript" | "summaries">("content");
  const [showSidePanel, setShowSidePanel] = useState(true);
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

  // Mostra side panel só na aba de conteúdo
  const showPanelHere = showSidePanel && tab === "content";
  // Usado pra detectar contexto de "tem painel" na hora de mostrar o botão de toggle
  const hasContextPanel = summariesEnabled || transcriptEnabled || !!noteId;

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

          {hasContextPanel && tab === "content" && (
            <button
              type="button"
              className="editor-tab editor-tab-toggle"
              onClick={() => setShowSidePanel((v) => !v)}
              title={showSidePanel ? "Esconder painel" : "Mostrar painel"}
              style={{ marginLeft: "auto" }}
            >
              {showSidePanel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
          )}
        </div>
      )}

      {summariesEnabled && tab === "summaries" && (
        <SummariesPanel
          noteTitle={noteTitle || ""}
          noteContent={value}
          transcript={transcript}
          summaries={summaries!}
          templates={templates!}
          settings={settings!}
          onAddSummary={onAddSummary!}
          onDeleteSummary={onDeleteSummary!}
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
              </h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--color-text-muted)" }}>
                Cole aqui o texto bruto da transcrição. Será usado como fonte primária ao gerar sumários.
              </p>
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {(transcript || "").length.toLocaleString("pt-BR")} caracteres
            </div>
          </div>
          {audioFile && <TranscriptAudioPlayer filename={audioFile} />}
          <textarea
            value={transcript || ""}
            onChange={(e) => onTranscriptChange?.(e.target.value)}
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
                <AutoFocusPlugin />
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

                <OnChangePlugin onChange={handleEditorChange} />
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
