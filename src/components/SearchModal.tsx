import React, { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { Search, FileText, FolderKanban, Users, CheckSquare, X, CornerDownLeft } from "lucide-react";
import { Note } from "../types";

// Extrai o texto legível do conteúdo da nota (Lexical JSON) — buscar no JSON
// cru casaria com chaves estruturais ("root", "paragraph") e ignoraria o texto
// que o usuário realmente vê.
const noteText = (content: string): string => {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    const walk = (n: any): string => {
      if (!n) return "";
      if (typeof n.text === "string") return n.text;
      if (Array.isArray(n.children)) return n.children.map(walk).join(" ");
      return "";
    };
    return walk(parsed.root || parsed);
  } catch {
    return content;
  }
};

// Trecho de contexto ao redor da primeira ocorrência de `q` em `text`.
const buildSnippet = (text: string, q: string): string => {
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 32);
  const end = Math.min(text.length, idx + q.length + 64);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "…" + s;
  if (end < text.length) s = s + "…";
  return s;
};

// Onde a nota casou (prioriza título > conteúdo > transcrição > resumo) +
// trecho destacável. Título não gera snippet (já aparece em destaque).
interface NoteMatch {
  note: Note;
  label?: string;
  snippet?: string;
  /** Aba a abrir ao selecionar (alinhada às abas do RichTextEditor). */
  tab?: "content" | "transcript" | "summaries";
}

const matchNote = (n: Note, q: string): NoteMatch | null => {
  if (n.title.toLowerCase().includes(q)) return { note: n };
  const tagHit = (n.tags || []).find((t) => t.toLowerCase().includes(q));
  if (tagHit) return { note: n, label: "Tag", snippet: tagHit, tab: "content" };
  const content = noteText(n.content);
  if (content.toLowerCase().includes(q)) {
    return { note: n, label: "Conteúdo", snippet: buildSnippet(content, q), tab: "content" };
  }
  const transcript = n.transcript || "";
  if (transcript.toLowerCase().includes(q)) {
    return { note: n, label: "Transcrição", snippet: buildSnippet(transcript, q), tab: "transcript" };
  }
  for (const s of n.summaries || []) {
    if ((s.content || "").toLowerCase().includes(q)) {
      return {
        note: n,
        label: `Resumo · ${s.templateName}`,
        snippet: buildSnippet(s.content, q),
        tab: "summaries",
      };
    }
  }
  return null;
};

// Realça (negrito) as ocorrências de `q` dentro de `text`, sem regex (escapa
// caracteres especiais naturalmente por usar comparação em minúsculas).
const highlight = (text: string, q: string): React.ReactNode => {
  if (!q) return text;
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark
        key={key++}
        style={{
          background: "var(--bg-badge-orange, #fdf1e8)",
          color: "var(--color-badge-orange, #bc4c00)",
          borderRadius: 3,
          padding: "0 1px",
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return out;
};

export const SearchModal: React.FC = () => {
  const { db, searchOpen, setSearchOpen, setCurrentView, setSelectedEntityId, setPendingNoteTab, setPendingNoteQuery } = useApp();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Keyboard shortcut Listener for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  // Focus input when modal opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setActiveIndex(0);
    }
  }, [searchOpen]);

  // Reseta o item ativo a cada nova busca
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Mantém o item ativo visível ao navegar por teclado
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!searchOpen) return null;

  // Filter items
  const cleanQuery = query.toLowerCase().trim();

  const filteredPeople = cleanQuery
    ? db.people.filter(
        (p) =>
          p.name.toLowerCase().includes(cleanQuery) ||
          p.role.toLowerCase().includes(cleanQuery) ||
          p.department.toLowerCase().includes(cleanQuery)
      )
    : [];

  const filteredProjects = cleanQuery
    ? db.projects.filter(
        (p) =>
          p.name.toLowerCase().includes(cleanQuery) ||
          p.description.toLowerCase().includes(cleanQuery) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(cleanQuery))
      )
    : [];

  const filteredNotes: NoteMatch[] = cleanQuery
    ? (db.notes
        .map((n) => matchNote(n, cleanQuery))
        .filter(Boolean) as NoteMatch[])
    : [];

  const filteredTasks = cleanQuery
    ? db.tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(cleanQuery) ||
          (t.tags || []).some((tg) => tg.toLowerCase().includes(cleanQuery))
      )
    : [];

  const hasResults =
    filteredPeople.length > 0 ||
    filteredProjects.length > 0 ||
    filteredNotes.length > 0 ||
    filteredTasks.length > 0;

  const handleSelect = (view: string, id: string | null, tab?: string) => {
    setPendingNoteTab(tab ?? null);
    // Só carrega o termo quando o destino é uma nota com aba específica (para
    // rolar/realçar até a ocorrência). Título não precisa.
    setPendingNoteQuery(view === "notas" && tab ? cleanQuery : null);
    setSelectedEntityId(id);
    setCurrentView(view);
    setSearchOpen(false);
  };

  // Lista achatada na ORDEM de exibição (notas → projetos → pessoas → tarefas)
  // para a navegação por teclado mapear no item certo.
  const flatResults: { view: string; id: string | null; tab?: string }[] = [
    ...filteredNotes.map((m) => ({ view: "notas", id: m.note.id, tab: m.tab })),
    ...filteredProjects.map((p) => ({ view: "projetos", id: p.id })),
    ...filteredPeople.map((p) => ({ view: "pessoas", id: p.id })),
    ...filteredTasks.map(() => ({ view: "tarefas", id: null })),
  ];
  const notesOffset = 0;
  const projectsOffset = filteredNotes.length;
  const peopleOffset = projectsOffset + filteredProjects.length;
  const tasksOffset = peopleOffset + filteredPeople.length;

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (flatResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = flatResults[activeIndex];
      if (sel) handleSelect(sel.view, sel.id, sel.tab);
    }
  };

  // Props comuns para destacar/rastrear o item ativo (teclado + mouse)
  const activeProps = (idx: number) => ({
    ref: idx === activeIndex ? activeItemRef : undefined,
    onMouseMove: () => setActiveIndex(idx),
    "data-active": idx === activeIndex ? "true" : undefined,
    style: idx === activeIndex ? { background: "var(--bg-active-sidebar, #eef0f3)" } : undefined,
  });

  return (
    <div className="modal-overlay" onClick={() => setSearchOpen(false)}>
      <div className="modal-content search-modal" onClick={(e) => e.stopPropagation()}>
        {/* Search header */}
        <div className="search-modal-header">
          <Search size={20} className="nav-icon" />
          <input
            ref={inputRef}
            type="text"
            className="search-modal-input"
            placeholder="Pesquisar notas, transcrições, resumos, pessoas, projetos e tarefas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleListKeyDown}
          />
          <button className="modal-close-btn" style={{ position: "static" }} onClick={() => setSearchOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="search-results">
          {!query && (
            <div className="empty-state" style={{ padding: "32px 0" }}>
              <span className="empty-text">Digite algo para buscar no workspace...</span>
            </div>
          )}

          {query && !hasResults && (
            <div className="empty-state" style={{ padding: "32px 0" }}>
              <span className="empty-text">Nenhum resultado encontrado para "{query}"</span>
            </div>
          )}

          {filteredNotes.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div className="search-result-group-title">Notas</div>
              {filteredNotes.map((m, i) => (
                <button
                  key={m.note.id}
                  className="search-result-item"
                  onClick={() => handleSelect("notas", m.note.id, m.tab)}
                  {...activeProps(notesOffset + i)}
                  style={{
                    ...(activeProps(notesOffset + i).style || {}),
                    ...(m.snippet ? { alignItems: "flex-start", height: "auto", padding: "8px 12px" } : {}),
                  }}
                >
                  <FileText size={14} className="search-result-icon" style={m.snippet ? { marginTop: 2 } : undefined} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span className="search-result-title" style={{ flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {highlight(m.note.title || "Sem título", cleanQuery)}
                      </span>
                      {m.label && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: "var(--bg-badge-gray, #f1f1ef)",
                            color: "var(--color-badge-gray, #4b4a47)",
                          }}
                        >
                          {m.label}
                        </span>
                      )}
                    </div>
                    {m.snippet && (
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {highlight(m.snippet, cleanQuery)}
                      </span>
                    )}
                  </div>
                  <span className="search-result-subtitle" style={m.snippet ? { marginTop: 2 } : undefined}>
                    {m.note.date}
                  </span>
                </button>
              ))}
            </div>
          )}

          {filteredProjects.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div className="search-result-group-title">Projetos</div>
              {filteredProjects.map((project, i) => (
                <button
                  key={project.id}
                  className="search-result-item"
                  onClick={() => handleSelect("projetos", project.id)}
                  {...activeProps(projectsOffset + i)}
                >
                  <FolderKanban size={14} className="search-result-icon" />
                  <span className="search-result-title">{project.name}</span>
                </button>
              ))}
            </div>
          )}

          {filteredPeople.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div className="search-result-group-title">Pessoas</div>
              {filteredPeople.map((person, i) => (
                <button
                  key={person.id}
                  className="search-result-item"
                  onClick={() => handleSelect("pessoas", person.id)}
                  {...activeProps(peopleOffset + i)}
                >
                  <Users size={14} className="search-result-icon" />
                  <span className="search-result-title">{person.name}</span>
                  <span className="search-result-subtitle">{person.role}</span>
                </button>
              ))}
            </div>
          )}

          {filteredTasks.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div className="search-result-group-title">Tarefas</div>
              {filteredTasks.map((task, i) => (
                <button
                  key={task.id}
                  className="search-result-item"
                  onClick={() => handleSelect("tarefas", null)}
                  {...activeProps(tasksOffset + i)}
                >
                  <CheckSquare size={14} className="search-result-icon" />
                  <span className="search-result-title" style={{ textDecoration: task.completed ? "line-through" : "none" }}>
                    {task.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {hasResults && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "8px 14px",
              borderTop: "1px solid var(--border-color)",
              fontSize: 11,
              color: "var(--color-text-muted)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <kbd style={kbdStyle}>↑</kbd>
              <kbd style={kbdStyle}>↓</kbd> navegar
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <kbd style={kbdStyle}>
                <CornerDownLeft size={10} />
              </kbd>
              abrir
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <kbd style={kbdStyle}>esc</kbd> fechar
            </span>
            <span style={{ marginLeft: "auto" }}>{flatResults.length} resultado{flatResults.length === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const kbdStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 18,
  height: 18,
  padding: "0 4px",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  background: "var(--bg-sidebar)",
  fontSize: 10,
  fontFamily: "inherit",
};
