import React, { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { Note } from "../types";
import {
  FileText,
  ArrowLeft,
  Trash2,
  Plus,
  Calendar,
  FolderKanban,
  Search,
  X,
  Users,
  Mic,
  Sparkles,
  Volume2,
} from "lucide-react";

import { RichTextEditor } from "../components/RichTextEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NoteChat } from "../components/NoteChat";

// ---------- helpers ----------

const toDateOnly = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const parseLocal = (iso: string) => {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y) return new Date(NaN);
  return new Date(y, (m || 1) - 1, d || 1);
};

const daysBetween = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / 86400000);

const relativeDate = (iso: string, today: Date): string => {
  const d = parseLocal(iso);
  if (isNaN(d.getTime())) return iso || "";
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = daysBetween(d, start);
  if (diff === 0) return "hoje";
  if (diff === -1) return "ontem";
  if (diff < 0 && diff >= -6) return `há ${-diff} dias`;
  if (diff === 1) return "amanhã";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
};

const bucketFor = (iso: string, today: Date): string => {
  const d = parseLocal(iso);
  if (isNaN(d.getTime())) return "Sem data";
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = daysBetween(d, start);
  if (diff >= 0) return "Próximas";
  if (diff === -1 || diff === 0) return "Hoje & ontem";
  if (diff >= -7) return "Últimos 7 dias";
  if (diff >= -30) return "Últimos 30 dias";
  if (d.getFullYear() === today.getFullYear()) return "Este ano";
  return `${d.getFullYear()}`;
};

const BUCKET_ORDER = [
  "Próximas",
  "Hoje & ontem",
  "Últimos 7 dias",
  "Últimos 30 dias",
  "Este ano",
];

const getContentPreview = (content: string): string => {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    const walk = (n: any): string => {
      if (!n) return "";
      if (typeof n.text === "string") return n.text;
      if (Array.isArray(n.children)) return n.children.map(walk).join(" ");
      return "";
    };
    const txt = walk(parsed.root || parsed).replace(/\s+/g, " ").trim();
    return txt.length > 160 ? txt.slice(0, 160).trimEnd() + "…" : txt;
  } catch {
    const txt = content
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return txt.length > 160 ? txt.slice(0, 160).trimEnd() + "…" : txt;
  }
};

const initialsOf = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

// ---------- main component ----------

export const NotesView: React.FC = () => {
  const {
    db,
    selectedEntityId,
    setSelectedEntityId,
    addNote,
    updateNote,
    deleteNote,
    addPerson,
  } = useApp();

  const [participantSearch, setParticipantSearch] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // List filters
  const [listSearch, setListSearch] = useState("");
  const [filterProjectId, setFilterProjectId] = useState<string>("__all");
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);

  // Close participant dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus + select-all in title when a freshly created note is opened
  useEffect(() => {
    if (justCreatedId && selectedEntityId === justCreatedId && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
      setJustCreatedId(null);
    }
  }, [justCreatedId, selectedEntityId]);

  // Cmd/Ctrl+N → create new note (only when on list view)
  // Esc on detail view → back to list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "n" || e.key === "N") && !selectedEntityId) {
        // Don't intercept if user is typing in a form field
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        handleCreateNote();
      } else if (e.key === "Escape" && selectedEntityId) {
        const t = e.target as HTMLElement | null;
        // Don't escape out while typing in title/property bar
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        setSelectedEntityId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityId]);

  const handleCreateNote = async () => {
    const newId = await addNote({
      title: "Nova Nota",
      content: "",
      date: toDateOnly(new Date()),
      projectId: filterProjectId !== "__all" ? filterProjectId : null,
      peopleIds: [],
    });
    setJustCreatedId(newId);
    setSelectedEntityId(newId);
  };

  const handleDateChange = async (newDate: string) => {
    if (!selectedEntityId) return;
    const note = db.notes.find((n) => n.id === selectedEntityId);
    if (note && newDate) await updateNote({ ...note, date: newDate });
  };

  const handleProjectChange = async (projId: string) => {
    if (!selectedEntityId) return;
    const note = db.notes.find((n) => n.id === selectedEntityId);
    if (note) await updateNote({ ...note, projectId: projId || null });
  };

  // --- Persistência com debounce de conteúdo/transcrição ---
  // Salvar a cada keystroke serializava o banco INTEIRO via IPC + escrevia o
  // db.json completo em disco, e o setDb re-renderizava o app todo — o editor
  // travava visivelmente (pior ainda durante uma gravação). O Lexical/textarea
  // guardam o próprio estado, então o db pode ficar ~700 ms atrás sem efeito
  // visível. O flush acontece no timer, ao trocar de nota, ao desmontar e
  // quando a janela perde o foco.
  const dbRef = useRef(db);
  dbRef.current = db;
  const updateNoteRef = useRef(updateNote);
  updateNoteRef.current = updateNote;
  const pendingFieldsRef = useRef<{ noteId: string; fields: Partial<Note> } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingFields = async () => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const pending = pendingFieldsRef.current;
    pendingFieldsRef.current = null;
    if (!pending) return;
    // Busca a nota fresca: title/people/summaries podem ter mudado no meio
    const note = dbRef.current.notes.find((n) => n.id === pending.noteId);
    if (note) await updateNoteRef.current({ ...note, ...pending.fields });
  };
  const flushRef = useRef(flushPendingFields);
  flushRef.current = flushPendingFields;

  const queueNoteFields = (noteId: string, fields: Partial<Note>) => {
    if (pendingFieldsRef.current && pendingFieldsRef.current.noteId !== noteId) {
      void flushRef.current();
    }
    pendingFieldsRef.current = {
      noteId,
      fields: { ...pendingFieldsRef.current?.fields, ...fields },
    };
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => void flushRef.current(), 700);
  };

  // Flush ao trocar de nota e ao desmontar a view
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, [selectedEntityId]);

  // Flush quando a janela perde o foco (minimiza perda ao fechar o app)
  useEffect(() => {
    const onBlur = () => void flushRef.current();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const handleContentChange = (newContent: string) => {
    if (!selectedEntityId) return;
    queueNoteFields(selectedEntityId, { content: newContent });
  };

  // Título com estado local + mesmo debounce do conteúdo: salvar a cada tecla
  // serializava o db inteiro por keystroke e fazia a digitação engasgar
  // (justo no início da reunião, quando o título é escrito).
  const [titleDraft, setTitleDraft] = useState("");
  useEffect(() => {
    const note = dbRef.current.notes.find((n) => n.id === selectedEntityId);
    setTitleDraft(note?.title ?? "");
  }, [selectedEntityId]);

  const handleTitleChange = (newTitle: string) => {
    if (!selectedEntityId) return;
    setTitleDraft(newTitle);
    queueNoteFields(selectedEntityId, { title: newTitle });
  };

  const togglePersonParticipant = async (personId: string) => {
    if (!selectedEntityId) return;
    const note = db.notes.find((n) => n.id === selectedEntityId);
    if (note) {
      const isTagged = note.peopleIds.includes(personId);
      const newPeopleIds = isTagged
        ? note.peopleIds.filter((id) => id !== personId)
        : [...note.peopleIds, personId];
      await updateNote({ ...note, peopleIds: newPeopleIds });
    }
  };

  // Cria uma pessoa "na hora" a partir do texto buscado e já a marca na nota,
  // sem sair da tela. Os demais campos ficam vazios para edição posterior em
  // Pessoas. Marca como contato (isContact) por ser um cadastro rápido.
  const [creatingPerson, setCreatingPerson] = useState(false);
  const quickCreateParticipant = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !selectedEntityId || creatingPerson) return;
    setCreatingPerson(true);
    try {
      const newId = await addPerson({
        name: trimmed,
        role: "",
        email: "",
        department: "",
        managerId: null,
        isContact: true,
      });
      const note = dbRef.current.notes.find((n) => n.id === selectedEntityId);
      if (note && !note.peopleIds.includes(newId)) {
        await updateNote({ ...note, peopleIds: [...note.peopleIds, newId] });
      }
      setParticipantSearch("");
      setIsDropdownOpen(false);
    } finally {
      setCreatingPerson(false);
    }
  };

  const handleDelete = (id: string) => setPendingDeleteId(id);

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    await deleteNote(id);
    if (selectedEntityId === id) setSelectedEntityId(null);
  };

  const selectedNote = db.notes.find((n) => n.id === selectedEntityId);
  const pendingDeleteNote = pendingDeleteId
    ? db.notes.find((n) => n.id === pendingDeleteId)
    : null;

  // ---------- filtered + grouped list ----------

  const filteredNotes = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return db.notes
      .filter((n) => {
        if (filterProjectId === "__none" && n.projectId) return false;
        if (filterProjectId !== "__all" && filterProjectId !== "__none" && n.projectId !== filterProjectId) return false;
        if (!q) return true;
        const inTitle = (n.title || "").toLowerCase().includes(q);
        const inContent = getContentPreview(n.content).toLowerCase().includes(q);
        const inPeople = n.peopleIds.some((pid) =>
          (db.people.find((p) => p.id === pid)?.name || "").toLowerCase().includes(q),
        );
        return inTitle || inContent || inPeople;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [db.notes, db.people, listSearch, filterProjectId]);

  const groupedNotes = useMemo(() => {
    const groups = new Map<string, typeof filteredNotes>();
    for (const n of filteredNotes) {
      const bucket = bucketFor(n.date, today);
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket)!.push(n);
    }
    const known = BUCKET_ORDER.filter((b) => groups.has(b));
    const rest = Array.from(groups.keys())
      .filter((b) => !BUCKET_ORDER.includes(b))
      .sort((a, b) => b.localeCompare(a)); // year buckets, recent first
    return [...known, ...rest].map((label) => [label, groups.get(label)!] as const);
  }, [filteredNotes, today]);

  const totalNotes = db.notes.length;
  const hasActiveFilters = listSearch.trim() !== "" || filterProjectId !== "__all";

  // ---------- render ----------

  return (
    <div className={`view-container ${selectedEntityId ? "note-editing-mode" : ""}`}>
      {!selectedEntityId ? (
        /* ====================== LIST VIEW ====================== */
        <div>
          {/* Header */}
          <div className="people-header">
            <div>
              <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <FileText size={24} />
                <span>Notas de Reunião</span>
              </h1>
              <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
                Revise suas atas de reunião e anotações organizadas cronologicamente.
                {totalNotes > 0 && (
                  <>
                    {" "}
                    <span style={{ color: "var(--color-text-muted)" }}>
                      · {totalNotes} nota{totalNotes === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </p>
            </div>
            <button
              className="btn-primary"
              onClick={handleCreateNote}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
              title="Nova nota (⌘N)"
            >
              <Plus size={14} />
              <span>Nova Nota</span>
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 10,
                  opacity: 0.7,
                  border: "1px solid currentColor",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                ⌘N
              </span>
            </button>
          </div>

          {/* Filter bar */}
          {totalNotes > 0 && (
            <div
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                marginBottom: "16px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 420 }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--color-text-muted)",
                  }}
                />
                <input
                  type="text"
                  className="form-input"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="Buscar por título, conteúdo ou participante..."
                  style={{ paddingLeft: 34, paddingRight: listSearch ? 30 : 12, fontSize: 13, width: "100%" }}
                />
                {listSearch && (
                  <button
                    onClick={() => setListSearch("")}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                      display: "flex",
                      padding: 2,
                    }}
                    title="Limpar busca"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <FilterPill active={filterProjectId === "__all"} onClick={() => setFilterProjectId("__all")} label="Todos os projetos" />
                <FilterPill active={filterProjectId === "__none"} onClick={() => setFilterProjectId("__none")} label="Sem projeto" />
                {db.projects.slice(0, 6).map((p) => (
                  <FilterPill
                    key={p.id}
                    active={filterProjectId === p.id}
                    onClick={() => setFilterProjectId(p.id)}
                    label={p.name}
                  />
                ))}
                {db.projects.length > 6 && (
                  <select
                    className="form-select"
                    value={db.projects.slice(0, 6).some((p) => p.id === filterProjectId) ? "" : filterProjectId}
                    onChange={(e) => e.target.value && setFilterProjectId(e.target.value)}
                    style={{ fontSize: 12, padding: "4px 8px" }}
                  >
                    <option value="">Mais projetos…</option>
                    {db.projects.slice(6).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setListSearch("");
                    setFilterProjectId("__all");
                  }}
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}

          {/* Empty states / list */}
          {totalNotes === 0 ? (
            <EmptyState
              title="Nenhuma nota ainda"
              subtitle="Crie sua primeira nota de reunião para começar a organizar suas anotações."
              ctaLabel="Criar primeira nota"
              onCta={handleCreateNote}
            />
          ) : filteredNotes.length === 0 ? (
            <EmptyState
              title="Nada encontrado"
              subtitle="Tente outra busca ou limpe os filtros."
              ctaLabel="Limpar filtros"
              onCta={() => {
                setListSearch("");
                setFilterProjectId("__all");
              }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {groupedNotes.map(([bucket, notes]) => (
                <div key={bucket}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--color-text-muted)",
                      marginBottom: 8,
                      paddingLeft: 4,
                    }}
                  >
                    {bucket}
                    <span style={{ marginLeft: 8, fontWeight: 500, opacity: 0.7 }}>
                      {notes.length}
                    </span>
                  </div>
                  <div className="notes-view-list">
                    {notes.map((note) => {
                      const project = db.projects.find((p) => p.id === note.projectId);
                      const participants = note.peopleIds
                        .map((id) => db.people.find((p) => p.id === id))
                        .filter(Boolean) as { id: string; name: string }[];
                      return (
                        <div
                          key={note.id}
                          className="note-row"
                          onClick={() => setSelectedEntityId(note.id)}
                        >
                          <div className="note-row-left">
                            <span className="note-row-title">{note.title || "Sem título"}</span>
                            <div className="note-row-meta">
                              <span title={new Date(note.date).toLocaleDateString("pt-BR")}>
                                {relativeDate(note.date, today)}
                              </span>
                              {project && (
                                <span className="task-meta-tag project" style={{ margin: 0 }}>
                                  {project.name}
                                </span>
                              )}
                              {note.transcript && note.transcript.trim().length > 0 && (
                                <span
                                  title="Possui transcrição"
                                  style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0066cc" }}
                                >
                                  <Mic size={12} />
                                </span>
                              )}
                              {note.audioFile && (
                                <span
                                  title="Possui áudio"
                                  style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#1f8e3d" }}
                                >
                                  <Volume2 size={12} />
                                </span>
                              )}
                              {note.summaries && note.summaries.length > 0 && (
                                <span
                                  title={`${note.summaries.length} sumário(s) gerado(s)`}
                                  style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#8250df" }}
                                >
                                  <Sparkles size={12} />
                                  <span style={{ fontSize: 11, fontWeight: 600 }}>{note.summaries.length}</span>
                                </span>
                              )}
                              {participants.length > 0 && (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    marginLeft: 4,
                                  }}
                                  title={participants.map((p) => p.name).join(", ")}
                                >
                                  {participants.slice(0, 3).map((p, i) => (
                                    <span
                                      key={p.id}
                                      style={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: "50%",
                                        background: "var(--bg-badge-gray)",
                                        color: "var(--color-text-main)",
                                        fontSize: 9,
                                        fontWeight: 700,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        border: "2px solid white",
                                        marginLeft: i === 0 ? 0 : -6,
                                      }}
                                    >
                                      {initialsOf(p.name)}
                                    </span>
                                  ))}
                                  {participants.length > 3 && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "var(--color-text-muted)",
                                        marginLeft: 4,
                                      }}
                                    >
                                      +{participants.length - 3}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                            {note.content && (
                              <p
                                style={{
                                  fontSize: 13,
                                  color: "var(--color-text-muted)",
                                  marginTop: 6,
                                  lineHeight: 1.4,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                }}
                              >
                                {getContentPreview(note.content) || "Nota vazia"}
                              </p>
                            )}
                          </div>
                          <button
                            className="task-delete-btn"
                            style={{ opacity: 0.6 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(note.id);
                            }}
                            title="Excluir nota"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ====================== DETAIL VIEW ====================== */
        selectedNote && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div className="detail-header">
              <div
                className="detail-title-wrapper"
                style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}
              >
                <button
                  className="btn-icon"
                  onClick={() => setSelectedEntityId(null)}
                  style={{ flexShrink: 0 }}
                  title="Voltar para lista (Esc)"
                >
                  <ArrowLeft size={16} />
                </button>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleDraft}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontFamily: "var(--font-title)",
                    fontSize: 32,
                    fontWeight: 800,
                    outline: "none",
                    flex: 1,
                    minWidth: 300,
                    width: "100%",
                    letterSpacing: "-0.02em",
                  }}
                  placeholder="Título da nota..."
                />
              </div>
              <button
                className="btn-icon"
                style={{ color: "#cf222e", flexShrink: 0 }}
                onClick={() => handleDelete(selectedNote.id)}
                title="Excluir nota"
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* Compact Properties Bar */}
            <div
              style={{
                display: "flex",
                gap: 12,
                padding: "10px 24px",
                backgroundColor: "#f8f9fa",
                borderBottom: "1px solid var(--color-border)",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Calendar size={14} style={{ color: "var(--color-text-muted)" }} />
                <input
                  type="date"
                  className="form-input"
                  value={selectedNote.date}
                  onChange={(e) => handleDateChange(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 8px", width: 140 }}
                />
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  ({relativeDate(selectedNote.date, today)})
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <FolderKanban size={14} style={{ color: "var(--color-text-muted)" }} />
                <select
                  className="form-select"
                  value={selectedNote.projectId || ""}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 8px", width: 160 }}
                >
                  <option value="">Sem Projeto</option>
                  {db.projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Participants */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                <Users size={14} style={{ color: "var(--color-text-muted)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 }}>
                  {selectedNote.peopleIds.map((pid) => {
                    const person = db.people.find((p) => p.id === pid);
                    if (!person) return null;
                    return (
                      <div
                        key={pid}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          backgroundColor: "#e8eaed",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        <span>{person.name}</span>
                        <button
                          onClick={() => togglePersonParticipant(pid)}
                          title="Remover"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: 2,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "var(--color-text-muted)",
                            borderRadius: "50%",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.color = "#cf222e";
                            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(207, 34, 46, 0.1)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)";
                            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                          }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  })}

                  <div ref={autocompleteRef} style={{ position: "relative" }}>
                    <button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "3px 8px",
                        backgroundColor: "#ffffff",
                        border: "1px solid var(--border-color)",
                        borderRadius: 12,
                        fontSize: 11,
                        cursor: "pointer",
                        color: "var(--color-text-muted)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--color-text-main)";
                        (e.currentTarget as HTMLElement).style.color = "var(--color-text-main)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
                        (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)";
                      }}
                    >
                      <Plus size={10} />
                      <span>Adicionar</span>
                    </button>

                    {isDropdownOpen && (() => {
                      const trimmedSearch = participantSearch.trim();
                      const searchLower = trimmedSearch.toLowerCase();
                      const filtered = db.people.filter((p) => {
                        if (selectedNote.peopleIds.includes(p.id)) return false;
                        if (!searchLower) return true;
                        return (
                          p.name.toLowerCase().includes(searchLower) ||
                          p.role.toLowerCase().includes(searchLower)
                        );
                      });
                      // Mostra "Criar" quando há texto digitado e nenhuma pessoa
                      // (já cadastrada) tem exatamente esse nome.
                      const hasExactMatch = db.people.some(
                        (p) => p.name.toLowerCase() === searchLower,
                      );
                      const canQuickCreate = trimmedSearch.length > 0 && !hasExactMatch;

                      return (
                        <div
                          style={{
                            position: "absolute",
                            top: "calc(100% + 4px)",
                            left: 0,
                            minWidth: 280,
                            backgroundColor: "#ffffff",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--border-radius-md)",
                            boxShadow: "var(--shadow-lg)",
                            zIndex: 50,
                            padding: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 8px",
                              marginBottom: 6,
                              border: "1px solid var(--border-color)",
                              borderRadius: 6,
                            }}
                          >
                            <Search size={12} style={{ color: "var(--color-text-muted)" }} />
                            <input
                              type="text"
                              value={participantSearch}
                              onChange={(e) => setParticipantSearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && canQuickCreate) {
                                  e.preventDefault();
                                  void quickCreateParticipant(trimmedSearch);
                                }
                              }}
                              placeholder="Buscar ou criar pessoa..."
                              autoFocus
                              style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, flex: 1 }}
                            />
                            {participantSearch && (
                              <button
                                onClick={() => setParticipantSearch("")}
                                style={{
                                  display: "flex",
                                  padding: 2,
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                  color: "var(--color-text-muted)",
                                }}
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                          <div style={{ maxHeight: 200, overflowY: "auto" }}>
                            {filtered.length > 0 ? (
                              filtered.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => {
                                    togglePersonParticipant(p.id);
                                    setParticipantSearch("");
                                    setIsDropdownOpen(false);
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    width: "100%",
                                    padding: "6px 8px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    fontSize: 12,
                                  }}
                                  onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-sidebar)";
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                                  }}
                                >
                                  <div className="profile-avatar" style={{ width: 24, height: 24, fontSize: 9 }}>
                                    {initialsOf(p.name)}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 11 }}>{p.name}</div>
                                    <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{p.role}</div>
                                  </div>
                                </button>
                              ))
                            ) : (
                              !canQuickCreate && (
                                <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "var(--color-text-muted)" }}>
                                  {trimmedSearch ? "Nenhuma pessoa encontrada" : "Digite para buscar ou criar"}
                                </div>
                              )
                            )}

                            {canQuickCreate && (
                              <button
                                onClick={() => void quickCreateParticipant(trimmedSearch)}
                                disabled={creatingPerson}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  width: "100%",
                                  padding: "6px 8px",
                                  marginTop: filtered.length > 0 ? 4 : 0,
                                  borderRadius: 6,
                                  border: "none",
                                  background: "transparent",
                                  cursor: creatingPerson ? "default" : "pointer",
                                  textAlign: "left",
                                  fontSize: 12,
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-sidebar)";
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    background: "#e7f3ff",
                                    color: "#0066cc",
                                    flexShrink: 0,
                                  }}
                                >
                                  <Plus size={14} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 11 }}>
                                    {creatingPerson ? "Criando…" : `Criar “${trimmedSearch}”`}
                                  </div>
                                  <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                                    Nova pessoa adicionada à nota
                                  </div>
                                </div>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Editor */}
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
              <RichTextEditor
                key={selectedNote.id}
                value={selectedNote.content}
                onChange={handleContentChange}
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                summaries={selectedNote.summaries || []}
                templates={db.templates || []}
                settings={
                  db.settings || {
                    url: "http://localhost:11434",
                    model: "llama3.2",
                    language: "pt-BR",
                  }
                }
                onAddSummary={async (summary) => {
                  await updateNote({
                    ...selectedNote,
                    summaries: [summary, ...(selectedNote.summaries || [])],
                  });
                }}
                onUpdateSummary={async (summary) => {
                  await updateNote({
                    ...selectedNote,
                    summaries: (selectedNote.summaries || []).map((s) =>
                      s.id === summary.id ? summary : s,
                    ),
                  });
                }}
                onDeleteSummary={async (id) => {
                  await updateNote({
                    ...selectedNote,
                    summaries: (selectedNote.summaries || []).filter((s) => s.id !== id),
                  });
                }}
                transcript={selectedNote.transcript || ""}
                onTranscriptChange={(t) => {
                  queueNoteFields(selectedNote.id, { transcript: t });
                }}
                audioFile={selectedNote.audioFile || ""}
              />
            </div>

            <NoteChat
              note={selectedNote}
              settings={
                db.settings || {
                  url: "http://localhost:11434",
                  model: "llama3.2",
                  language: "pt-BR",
                }
              }
            />
          </div>
        )
      )}

      <ConfirmDialog
        open={!!pendingDeleteNote}
        title="Excluir nota?"
        message={
          <>
            A nota <strong>{pendingDeleteNote?.title || "Sem título"}</strong> será
            removida permanentemente. As imagens anexadas que não estiverem em
            outras notas também serão apagadas.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};

// ---------- subcomponents ----------

const FilterPill: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({
  active,
  onClick,
  label,
}) => (
  <button
    onClick={onClick}
    style={{
      padding: "5px 12px",
      borderRadius: 999,
      border: active ? "1px solid var(--color-text-main)" : "1px solid var(--border-color)",
      background: active ? "var(--color-text-main)" : "var(--bg-card)",
      color: active ? "#fff" : "var(--color-text-main)",
      fontSize: 12,
      fontWeight: 500,
      cursor: "pointer",
      whiteSpace: "nowrap",
      maxWidth: 180,
      overflow: "hidden",
      textOverflow: "ellipsis",
    }}
    title={label}
  >
    {label}
  </button>
);

const EmptyState: React.FC<{
  title: string;
  subtitle: string;
  ctaLabel: string;
  onCta: () => void;
}> = ({ title, subtitle, ctaLabel, onCta }) => (
  <div
    style={{
      padding: "60px 24px",
      textAlign: "center",
      border: "1px dashed var(--border-color-dark)",
      borderRadius: "var(--border-radius-lg)",
      background: "var(--bg-sidebar)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 12,
    }}
  >
    <FileText size={36} style={{ color: "var(--color-text-muted)", opacity: 0.6 }} />
    <div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>{subtitle}</p>
    </div>
    <button className="btn-primary" onClick={onCta} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Plus size={14} />
      <span>{ctaLabel}</span>
    </button>
  </div>
);

export default NotesView;
