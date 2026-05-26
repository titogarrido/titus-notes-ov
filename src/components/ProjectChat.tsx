import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles, Trash2, FileText } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ChatMessage, chatWithOllama, noteToPlainText } from "../lib/ollama";
import { Note, Project, Task, Person, OllamaSettings } from "../types";

interface ProjectChatProps {
  project: Project;
  notes: Note[];
  tasks: Task[];
  people: Person[];
  settings: OllamaSettings;
}

interface UiMessage {
  role: "user" | "assistant";
  content: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  "pt-BR": "Português do Brasil",
  pt: "Português",
  en: "English",
  es: "Español",
  fr: "Français",
};

function buildSystemPrompt(
  project: Project,
  selectedNotes: Note[],
  tasks: Task[],
  people: Person[],
  settings: OllamaSettings,
): string {
  const lang = LANGUAGE_LABELS[settings.language || "pt-BR"] || "Português do Brasil";

  const projectDesc = noteToPlainText(project.description || "").trim();

  const notesBlock = selectedNotes.length
    ? selectedNotes
        .map((n, i) => {
          const body = noteToPlainText(n.content || "").trim();
          const transcript = (n.transcript || "").trim();
          const summaries = (n.summaries || [])
            .map(
              (s, si) =>
                `  [Sumário ${si + 1} · ${s.templateName || "Sumário"}]\n  ${s.content.trim()}`,
            )
            .join("\n\n");

          const parts: string[] = [];
          if (body) parts.push(`Anotações:\n${body}`);
          if (transcript) parts.push(`Transcrição:\n${transcript}`);
          if (summaries) parts.push(`Sumários:\n${summaries}`);

          return `--- Nota ${i + 1}: "${n.title || "(sem título)"}" · Data: ${n.date || "n/d"} ---\n${parts.join("\n\n") || "(sem conteúdo)"}`;
        })
        .join("\n\n")
    : "(nenhuma nota selecionada)";

  const tasksBlock = tasks.length
    ? tasks
        .map(
          (t) =>
            `- [${t.completed ? "x" : " "}] ${t.title}${t.dueDate ? ` — prazo ${t.dueDate}` : ""}`,
        )
        .join("\n")
    : "(nenhuma tarefa)";

  const peopleBlock = people.length
    ? people.map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ""}`).join("\n")
    : "(nenhuma pessoa)";

  return `Você é um assistente que responde perguntas sobre um projeto específico.
Idioma da resposta: ${lang}.
Baseie-se SOMENTE no contexto fornecido. Se a resposta não estiver no contexto, diga "Não consigo encontrar isso nas fontes deste projeto."
Cite datas, nomes e notas específicas quando aparecerem. Formate em Markdown (listas, negrito), mas NÃO use tabelas. Respostas curtas e diretas.

=== PROJETO ===
Nome: ${project.name}
Status: ${project.status || "—"}

=== DESCRIÇÃO / VISÃO GERAL ===
${projectDesc || "(sem descrição)"}

=== PESSOAS ENVOLVIDAS ===
${peopleBlock}

=== TAREFAS ===
${tasksBlock}

=== NOTAS SELECIONADAS (${selectedNotes.length}) ===
${notesBlock}`;
}

export const ProjectChat: React.FC<ProjectChatProps> = ({
  project,
  notes,
  tasks,
  people,
  settings,
}) => {
  const [open, setOpen] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(
    () => new Set(notes.map((n) => n.id)),
  );
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset when switching project
  useEffect(() => {
    setMessages([]);
    setInput("");
    setError(null);
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setSelectedNoteIds(new Set(notes.map((n) => n.id)));
  }, [project.id]);

  // Sync new notes into selection when notes list changes
  useEffect(() => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      notes.forEach((n) => {
        if (!prev.has(n.id)) next.add(n.id);
      });
      // remove ids that no longer exist
      for (const id of next) {
        if (!notes.find((n) => n.id === id)) next.delete(id);
      }
      return next;
    });
  }, [notes]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending]);

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selectedNotes = useMemo(
    () => notes.filter((n) => selectedNoteIds.has(n.id)),
    [notes, selectedNoteIds],
  );

  const hasContext = useMemo(() => {
    if (selectedNotes.length > 0) return true;
    if (noteToPlainText(project.description || "").trim()) return true;
    if (tasks.length > 0) return true;
    if (people.length > 0) return true;
    return false;
  }, [selectedNotes, project.description, tasks, people]);

  const suggestions = useMemo(
    () => [
      "Qual é o status atual deste projeto?",
      "Quais são os próximos passos e responsáveis?",
      "Resuma as principais decisões tomadas.",
      "Quais bloqueios ou riscos foram identificados?",
    ],
    [],
  );

  const toggleNote = (id: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setError(null);
    const newUserMsg: UiMessage = { role: "user", content };
    const nextHistory = [...messages, newUserMsg];
    setMessages(nextHistory);
    setInput("");
    setSending(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const systemPrompt = buildSystemPrompt(project, selectedNotes, tasks, people, settings);
      const apiMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...nextHistory.map((m) => ({ role: m.role, content: m.content })),
      ];
      const reply = await chatWithOllama(settings, apiMessages, { signal: ac.signal });
      setMessages((cur) => [...cur, { role: "assistant", content: reply }]);
    } catch (err: any) {
      if (ac.signal.aborted) return;
      console.error("Erro chat projeto IA:", err);
      setError(err?.message || "Falha ao contatar a IA.");
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setError(null);
    setSending(false);
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Perguntar à IA sobre este projeto"
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            zIndex: 900,
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "linear-gradient(135deg, #8250df 0%, #6639b6 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 24px rgba(130, 80, 223, 0.35)",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 12px 28px rgba(130, 80, 223, 0.45)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 8px 24px rgba(130, 80, 223, 0.35)";
          }}
        >
          <MessageCircle size={24} />
        </button>
      )}

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 15, 15, 0.18)",
              zIndex: 899,
            }}
          />
          <div
            role="dialog"
            aria-label="Chat com o projeto"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(480px, 100vw)",
              background: "#ffffff",
              borderLeft: "1px solid var(--border-color)",
              boxShadow: "-12px 0 32px rgba(0, 0, 0, 0.12)",
              zIndex: 900,
              display: "flex",
              flexDirection: "column",
              animation: "slideInRight 0.18s ease-out",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-color)",
                background: "linear-gradient(180deg, #faf7ff 0%, #ffffff 100%)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: "linear-gradient(135deg, #8250df 0%, #6639b6 100%)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Sparkles size={14} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Perguntar à IA</div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 340,
                    }}
                    title={project.name}
                  >
                    sobre "{project.name}"
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {messages.length > 0 && (
                  <button
                    className="btn-icon"
                    onClick={handleClear}
                    title="Limpar conversa"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  className="btn-icon"
                  onClick={() => setOpen(false)}
                  title="Fechar (Esc)"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Note chips selector */}
            <div
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid var(--border-color)",
                flexShrink: 0,
                background: "#fafafa",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Notas no contexto · {selectedNoteIds.size}/{notes.length} selecionadas
              </div>
              {notes.length === 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  Nenhuma nota vinculada a este projeto.
                </span>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 5,
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                >
                  {notes.map((n) => {
                    const active = selectedNoteIds.has(n.id);
                    return (
                      <button
                        key={n.id}
                        onClick={() => toggleNote(n.id)}
                        title={active ? "Remover do contexto" : "Adicionar ao contexto"}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: "pointer",
                          border: active ? "1px solid #d9cbf5" : "1px solid var(--border-color)",
                          background: active ? "#eee8fb" : "#f1f1ef",
                          color: active ? "#6639b6" : "var(--color-text-muted)",
                          opacity: active ? 1 : 0.65,
                          transition: "all 0.12s ease",
                          maxWidth: 200,
                          overflow: "hidden",
                        }}
                      >
                        <FileText size={10} style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {n.title || "Sem título"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Static context chips: description, tasks, people */}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                <StaticChip
                  label="Descrição"
                  active={!!noteToPlainText(project.description || "").trim()}
                />
                <StaticChip label={`Tarefas (${tasks.length})`} active={tasks.length > 0} />
                <StaticChip label={`Pessoas (${people.length})`} active={people.length > 0} />
              </div>
            </div>

            {/* Messages */}
            <div
              ref={listRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                background: "#fafafa",
              }}
            >
              {messages.length === 0 && !sending && (
                <div style={{ textAlign: "center", padding: "20px 8px" }}>
                  <Sparkles size={28} style={{ color: "#8250df", opacity: 0.7 }} />
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-muted)",
                      margin: "10px 0 16px",
                      lineHeight: 1.5,
                    }}
                  >
                    {hasContext
                      ? "Faça uma pergunta sobre este projeto — selecione as notas acima para refinar o contexto."
                      : "Este projeto ainda não tem notas, tarefas ou pessoas para usar como contexto."}
                  </p>
                  {hasContext && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          disabled={sending}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--border-color)",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: 12,
                            textAlign: "left",
                            color: "var(--color-text-main)",
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {messages.map((m, i) => (
                <MessageBubble key={i} role={m.role} content={m.content} />
              ))}

              {sending && (
                <div
                  style={{
                    alignSelf: "flex-start",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    padding: "6px 10px",
                  }}
                >
                  <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                  <span>Pensando…</span>
                  <button
                    onClick={handleStop}
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      border: "1px solid var(--border-color)",
                      background: "#fff",
                      borderRadius: 4,
                      padding: "2px 8px",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Parar
                  </button>
                </div>
              )}

              {error && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#cf222e",
                    background: "#fdecea",
                    padding: "8px 10px",
                    borderRadius: 6,
                  }}
                >
                  {error}
                </div>
              )}
            </div>

            {/* Composer */}
            <div
              style={{
                borderTop: "1px solid var(--border-color)",
                padding: 10,
                background: "#fff",
                display: "flex",
                gap: 6,
                alignItems: "flex-end",
                flexShrink: 0,
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  hasContext
                    ? "Pergunte algo sobre este projeto..."
                    : "Adicione notas ou tarefas ao projeto para conversar..."
                }
                rows={1}
                disabled={sending}
                style={{
                  flex: 1,
                  resize: "none",
                  border: "1px solid var(--border-color)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 13,
                  outline: "none",
                  fontFamily: "inherit",
                  maxHeight: 140,
                  minHeight: 36,
                  lineHeight: 1.4,
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={sending || !input.trim()}
                title="Enviar (Enter)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: "none",
                  cursor: sending || !input.trim() ? "not-allowed" : "pointer",
                  background:
                    sending || !input.trim()
                      ? "var(--bg-badge-gray)"
                      : "linear-gradient(135deg, #8250df 0%, #6639b6 100%)",
                  color: sending || !input.trim() ? "var(--color-text-muted)" : "#fff",
                }}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

const StaticChip: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <span
    style={{
      padding: "3px 8px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 600,
      background: active ? "#eef8f2" : "#f1f1ef",
      color: active ? "#1f883d" : "var(--color-text-muted)",
      border: active ? "1px solid #b7e4c7" : "1px solid var(--border-color)",
      opacity: active ? 1 : 0.6,
    }}
  >
    {active ? "✓ " : ""}{label}
  </span>
);

const MessageBubble: React.FC<{ role: "user" | "assistant"; content: string }> = ({
  role,
  content,
}) => {
  const isUser = role === "user";
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "85%",
        padding: "8px 12px",
        borderRadius: 12,
        background: isUser
          ? "linear-gradient(135deg, #8250df 0%, #6639b6 100%)"
          : "#fff",
        color: isUser ? "#fff" : "var(--color-text-main)",
        border: isUser ? "none" : "1px solid var(--border-color)",
        boxShadow: isUser
          ? "0 2px 6px rgba(130, 80, 223, 0.18)"
          : "0 1px 2px rgba(0,0,0,0.04)",
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {isUser ? (
        content
      ) : (
        <div className="note-chat-md">
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  );
};

export default ProjectChat;
