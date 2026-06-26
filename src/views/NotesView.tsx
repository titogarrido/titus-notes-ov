import React, { useState, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  Check,
  Tag,
} from "lucide-react";

import { RichTextEditor } from "../components/RichTextEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { NoteChat } from "../components/NoteChat";
import { TagInput } from "../components/TagInput";
import { TagChips } from "../components/TagChips";
import { ParticipantsField } from "../components/ParticipantsField";
import { Combobox } from "../components/Combobox";
import { allTags, normalizeTag } from "../lib/tags";

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
    patchNote,
    deleteNote,
    addPerson,
    pendingNoteTab,
    setPendingNoteTab,
    pendingNoteQuery,
    setPendingNoteQuery,
  } = useApp();

  // Aba + termo pedidos pela busca (ex.: match na transcrição) são consumidos
  // pelo editor via `initialTab`/`initialQuery`; limpamos logo depois (efeito de
  // filho roda antes do pai, então o RichTextEditor já leu os valores aqui).
  useEffect(() => {
    if (pendingNoteTab) setPendingNoteTab(null);
    if (pendingNoteQuery) setPendingNoteQuery(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNoteTab, pendingNoteQuery]);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // List filters
  const [listSearch, setListSearch] = useState("");
  const [filterProjectId, setFilterProjectId] = useState<string>("__all");
  const [filterTags, setFilterTags] = useState<string[]>([]); // normalizados (interseção)
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const today = useMemo(() => new Date(), []);

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

  const handleDateChange = (newDate: string) => {
    if (!newDate) return;
    commitNoteFields({ date: newDate });
  };

  const handleProjectChange = (projId: string) => {
    commitNoteFields({ projectId: projId || null });
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
  const patchNoteRef = useRef(patchNote);
  patchNoteRef.current = patchNote;
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
    // Aplica só os campos pendentes sobre o estado fresco (evita sobrescrever
    // mudanças concorrentes como uma transcrição recém-salva).
    await patchNoteRef.current(pending.noteId, pending.fields);
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

  // Mudanças discretas (data, projeto, pessoas) devem salvar IMEDIATAMENTE.
  // Passam pelo mesmo buffer para serem mescladas com conteúdo/título ainda
  // em debounce (evita sobrescrever edições em voo) e então faz flush na hora.
  const commitNoteFields = (fields: Partial<Note>) => {
    if (!selectedEntityId) return;
    queueNoteFields(selectedEntityId, fields);
    void flushRef.current();
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

  // ⌘S / Ctrl+S — salva a nota aberta on demand (flush imediato + confirmação).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        if (!selectedEntityId) return;
        e.preventDefault();
        void flushRef.current();
        setSavedNotice(true);
        window.setTimeout(() => setSavedNotice(false), 1500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEntityId]);

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

  const togglePersonParticipant = (personId: string) => {
    if (!selectedEntityId) return;
    // Usa a nota mais fresca (inclui qualquer alteração de pessoas já em buffer)
    const note = dbRef.current.notes.find((n) => n.id === selectedEntityId);
    const base = pendingFieldsRef.current?.fields.peopleIds ?? note?.peopleIds;
    if (!base) return;
    const isTagged = base.includes(personId);
    const newPeopleIds = isTagged
      ? base.filter((id) => id !== personId)
      : [...base, personId];
    commitNoteFields({ peopleIds: newPeopleIds });
  };

  // Cria uma pessoa "na hora" a partir do texto buscado e já a marca na nota,
  // sem sair da tela. Os demais campos ficam vazios para edição posterior em
  // Pessoas. Marca como contato (isContact) por ser um cadastro rápido.
  const quickCreateParticipant = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !selectedEntityId) return;
    const newId = await addPerson({
      name: trimmed,
      role: "",
      email: "",
      department: "",
      managerId: null,
      isContact: true,
    });
    const note = dbRef.current.notes.find((n) => n.id === selectedEntityId);
    const base = pendingFieldsRef.current?.fields.peopleIds ?? note?.peopleIds ?? [];
    if (!base.includes(newId)) {
      commitNoteFields({ peopleIds: [...base, newId] });
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
        if (filterTags.length > 0) {
          const noteTags = (n.tags || []).map(normalizeTag);
          if (!filterTags.every((ft) => noteTags.includes(ft))) return false;
        }
        if (!q) return true;
        const inTitle = (n.title || "").toLowerCase().includes(q);
        const inContent = getContentPreview(n.content).toLowerCase().includes(q);
        const inPeople = n.peopleIds.some((pid) =>
          (db.people.find((p) => p.id === pid)?.name || "").toLowerCase().includes(q),
        );
        const inTags = (n.tags || []).some((t) => t.toLowerCase().includes(q));
        return inTitle || inContent || inPeople || inTags;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [db.notes, db.people, listSearch, filterProjectId, filterTags]);

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
  const hasActiveFilters =
    listSearch.trim() !== "" || filterProjectId !== "__all" || filterTags.length > 0;

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

              {allTags(db).length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", maxHeight: 64, overflow: "auto" }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginRight: 2 }}>Tags:</span>
                  <TagChips
                    tags={allTags(db)}
                    activeTags={filterTags}
                    onToggle={(tag) => {
                      const n = normalizeTag(tag);
                      setFilterTags((prev) =>
                        prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
                      );
                    }}
                  />
                </div>
              )}

              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setListSearch("");
                    setFilterProjectId("__all");
                    setFilterTags([]);
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
                            {note.tags && note.tags.length > 0 && (
                              <div style={{ marginTop: 6 }}>
                                <TagChips tags={note.tags} />
                              </div>
                            )}
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
              {savedNotice && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#1f8e3d",
                    flexShrink: 0,
                    marginRight: 4,
                  }}
                >
                  <Check size={14} /> Salvo
                </span>
              )}
              <button
                className="btn-icon"
                style={{ color: "#cf222e", flexShrink: 0 }}
                onClick={() => handleDelete(selectedNote.id)}
                title="Excluir nota"
              >
                <Trash2 size={16} />
              </button>
            </div>


            {/* Editor */}
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
              <RichTextEditor
                key={selectedNote.id}
                value={selectedNote.content}
                onChange={handleContentChange}
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                propertiesPanel={
                  <div className="entity-props">
                    <div className="ep-row">
                      <div className="ep-label">
                        <Calendar size={13} /> Data
                      </div>
                      <input
                        type="date"
                        className="ep-date-input"
                        value={selectedNote.date}
                        onChange={(e) => handleDateChange(e.target.value)}
                      />
                      <div className="ep-hint">{relativeDate(selectedNote.date, today)}</div>
                    </div>

                    <div className="ep-row">
                      <div className="ep-label">
                        <FolderKanban size={13} /> Projeto
                      </div>
                      <Combobox
                        value={selectedNote.projectId || ""}
                        options={db.projects.map((proj) => ({ id: proj.id, label: proj.name }))}
                        onChange={(id) => handleProjectChange(id)}
                        emptyLabel="Sem projeto"
                        placeholder="Buscar projeto…"
                        noResultsText="Nenhum projeto encontrado"
                        compact
                      />
                    </div>

                    <div className="ep-row">
                      <div className="ep-label">
                        <Users size={13} /> Participantes
                      </div>
                      <ParticipantsField
                        selectedIds={selectedNote.peopleIds}
                        allPeople={db.people}
                        onToggle={togglePersonParticipant}
                        onQuickCreate={quickCreateParticipant}
                      />
                    </div>

                    <div className="ep-row">
                      <div className="ep-label">
                        <Tag size={13} /> Tags
                      </div>
                      <TagInput
                        tags={selectedNote.tags || []}
                        suggestions={allTags(db)}
                        onChange={(tags) => commitNoteFields({ tags })}
                        placeholder="Adicionar tags…"
                      />
                    </div>
                  </div>
                }
                initialTab={(pendingNoteTab as
                  | "content"
                  | "transcript"
                  | "summaries"
                  | "actions"
                  | null) || undefined}
                initialQuery={pendingNoteQuery || undefined}
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
                  await patchNote(selectedNote.id, (old) => ({
                    summaries: [summary, ...(old.summaries || [])],
                  }));
                }}
                onUpdateSummary={async (summary) => {
                  await patchNote(selectedNote.id, (old) => ({
                    summaries: (old.summaries || []).map((s) =>
                      s.id === summary.id ? summary : s,
                    ),
                  }));
                }}
                onDeleteSummary={async (id) => {
                  await patchNote(selectedNote.id, (old) => ({
                    summaries: (old.summaries || []).filter((s) => s.id !== id),
                  }));
                }}
                transcript={selectedNote.transcript || ""}
                onTranscriptChange={(t) => {
                  queueNoteFields(selectedNote.id, { transcript: t });
                }}
                audioFile={selectedNote.audioFile || ""}
                onAudioImported={async (filename) => {
                  // Áudio importado substitui qualquer gravação anterior: zera os
                  // sidecars por canal (mic) e a transcrição própria, que não
                  // correspondem mais ao novo arquivo.
                  const old = selectedNote.audioFile || "";
                  const oldMic = selectedNote.micFile || "";
                  await patchNote(selectedNote.id, {
                    audioFile: filename,
                    micFile: "",
                    selfTranscript: "",
                  });
                  // Remove o áudio antigo se nenhuma outra nota o usa.
                  const stale = [old, oldMic].filter(
                    (f) =>
                      f &&
                      f !== filename &&
                      !db.notes.some(
                        (n) => n.id !== selectedNote.id && (n.audioFile === f || n.micFile === f),
                      ),
                  );
                  if (stale.length > 0) {
                    try {
                      await invoke("delete_audios", { filenames: stale });
                    } catch (err) {
                      console.error("Erro ao remover áudio antigo:", err);
                    }
                  }
                }}
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
