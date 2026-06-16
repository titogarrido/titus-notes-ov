import React, { useState, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import {
  FileText,
  Plus,
  Folder,
  Users,
  Inbox,
  ChevronDown,
  Mic,
  Volume2,
  Sparkles,
  Check,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { Note } from "../types";

// --- helpers ---

const toDateOnly = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const parseLocal = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const relativeFromDays = (iso: string, today: Date) => {
  const days = Math.round(
    (parseLocal(iso).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "hoje";
  if (days === -1) return "ontem";
  if (days < 0) return `há ${-days} dias`;
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
};

const formatDateShortBR = (iso: string) => {
  const d = parseLocal(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
};

const extractPlainText = (content: string, max = 140): string => {
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
    return txt.length > max ? txt.slice(0, max).trimEnd() + "…" : txt;
  } catch {
    const txt = content.replace(/[#*`>-]/g, "").replace(/\s+/g, " ").trim();
    return txt.length > max ? txt.slice(0, max).trimEnd() + "…" : txt;
  }
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

const PROJECT_PALETTE = [
  { bg: "#fde2d4", fg: "#c2410c" },
  { bg: "#fde9b6", fg: "#a16207" },
  { bg: "#d1fadf", fg: "#1f8e3d" },
  { bg: "#dbe7ff", fg: "#1d4ed8" },
  { bg: "#f3dfff", fg: "#7e22ce" },
];

const colorForProject = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
};

const AVATAR_PALETTE = ["#dbe7ff", "#fde2e2", "#e2f0d6", "#f3dfff", "#fde9b6"];
const colorForPerson = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};

// --- component ---

type QuickKind = "nota" | "tarefa" | "pessoa";

export const Dashboard: React.FC = () => {
  const {
    db,
    setCurrentView,
    setSelectedEntityId,
    updateTask,
    addNote,
    addTask,
    addPerson,
  } = useApp();

  const today = new Date();
  const todayStr = toDateOnly(today);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Saudação
  const greetingPrefix = (() => {
    const h = today.getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  })();
  const greeting = `${greetingPrefix}, Tito.`;

  // ----- métricas de header -----
  const dow = today.getDay();
  const monday = new Date(startOfToday);
  monday.setDate(monday.getDate() - ((dow + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const notesThisWeek = db.notes.filter((n) => {
    const d = parseLocal(n.date);
    return d >= monday && d <= sunday;
  });

  // ----- Quick capture state -----
  const [quickKind, setQuickKind] = useState<QuickKind>("nota");
  const [quickText, setQuickText] = useState("");
  const [quickProjectId, setQuickProjectId] = useState<string>(
    db.projects[0]?.id || "",
  );
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [quickToast, setQuickToast] = useState<string | null>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Foca a captura rápida ao abrir o painel.
  useEffect(() => {
    quickInputRef.current?.focus();
  }, []);

  // Fecha o seletor de projeto ao clicar fora.
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [projectMenuOpen]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const flashToast = (msg: string) => {
    setQuickToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setQuickToast(null), 2500);
  };

  const quickProject = db.projects.find((p) => p.id === quickProjectId);

  const handleQuickSubmit = async () => {
    const text = quickText.trim();
    if (!text) return;
    if (quickKind === "nota") {
      const id = await addNote({
        title: text,
        content: "",
        date: todayStr,
        projectId: quickProjectId || null,
        peopleIds: [],
      });
      setQuickText("");
      if (id) {
        setSelectedEntityId(id);
        setCurrentView("notas");
      }
    } else if (quickKind === "tarefa") {
      await addTask({
        title: text,
        completed: false,
        dueDate: todayStr,
        projectId: quickProjectId || null,
        personId: null,
      });
      setQuickText("");
      flashToast(
        quickProject ? `Tarefa criada em ${quickProject.name}` : "Tarefa criada na caixa de entrada",
      );
      quickInputRef.current?.focus();
    } else if (quickKind === "pessoa") {
      await addPerson({
        name: text,
        role: "",
        email: "",
        department: "",
        managerId: null,
        isContact: true,
      });
      setQuickText("");
      flashToast(`Pessoa "${text}" criada`);
      quickInputRef.current?.focus();
    }
  };

  // ----- Projetos com métricas -----
  const projectsWithMeta = db.projects.map((proj) => {
    const projTasks = db.tasks.filter((t) => t.projectId === proj.id);
    const done = projTasks.filter((t) => t.completed).length;
    const total = projTasks.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const open = total - done;

    const STATUS_STYLES: Record<string, { label: string; bg: string; color: string }> = {
      "ideacao": { label: "Em ideação", bg: "#e9ecef", color: "#495057" },
      "concluido": { label: "Concluído", bg: "#d1fadf", color: "#1f8e3d" },
      "quase-la": { label: "Quase lá", bg: "#d1fadf", color: "#1f8e3d" },
      "pausado": { label: "Pausado", bg: "#fde9b6", color: "#a16207" },
      "em-andamento": { label: "Em andamento", bg: "#fde2d4", color: "#c2410c" },
    };

    // Prefer the explicit status stored on the project; fall back to deriving from tasks.
    let status: { label: string; bg: string; color: string };
    const explicit = typeof proj.status === "string" ? proj.status : "";
    if (explicit && STATUS_STYLES[explicit]) {
      status = STATUS_STYLES[explicit];
    } else if (total === 0) {
      status = STATUS_STYLES["ideacao"];
    } else if (open === 0) {
      status = STATUS_STYLES["concluido"];
    } else if (pct >= 70) {
      status = STATUS_STYLES["quase-la"];
    } else if (done === 0) {
      status = STATUS_STYLES["pausado"];
    } else {
      status = STATUS_STYLES["em-andamento"];
    }

    const latestNote = [...db.notes]
      .filter((n) => n.projectId === proj.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    return { proj, done, total, pct, status, latestNote };
  });

  // ----- Hoje = tarefas vencendo hoje ou atrasadas (todos os projetos) -----
  const dueTodayOrOverdue = db.tasks
    .filter(
      (t) =>
        !t.completed &&
        t.dueDate &&
        parseLocal(t.dueDate).getTime() <= startOfToday.getTime(),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)); // mais atrasadas primeiro
  const overdueCount = dueTodayOrOverdue.filter(
    (t) => parseLocal(t.dueDate).getTime() < startOfToday.getTime(),
  ).length;

  // ----- Caixa de entrada = tarefas sem projeto -----
  const inboxTasks = db.tasks.filter((t) => !t.completed && !t.projectId);

  // ----- Primeira execução: nada cadastrado ainda -----
  const isFirstRun =
    db.projects.length === 0 && db.notes.length === 0 && db.people.length === 0;

  // ----- Notas recentes (por última edição; cai para a data da reunião) -----
  const noteRecency = (n: Note) => n.updatedAt || n.date || "";
  const recentNotes = [...db.notes]
    .sort((a, b) => noteRecency(b).localeCompare(noteRecency(a)))
    .slice(0, 3);

  // ----- handlers -----
  const goToNote = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("notas");
  };
  const goToProject = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("projetos");
  };
  const goToPerson = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("pessoas");
  };

  const handleAssignTaskToProject = async (taskId: string, projectId: string) => {
    const t = db.tasks.find((x) => x.id === taskId);
    if (t) await updateTask({ ...t, projectId });
  };

  // ====== render ======

  return (
    <div
      className="view-container"
      style={{ display: "flex", flexDirection: "column", gap: "20px" }}
    >
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-title)",
              fontSize: "34px",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              display: "inline",
            }}
          >
            {greeting}
          </h1>{" "}
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            <StatLink
              onClick={() => {
                setSelectedEntityId(null);
                setCurrentView("projetos");
              }}
            >
              {db.projects.length} projeto{db.projects.length === 1 ? "" : "s"}
            </StatLink>{" "}
            ·{" "}
            <StatLink
              onClick={() => {
                setSelectedEntityId(null);
                setCurrentView("pessoas");
              }}
            >
              {db.people.length} pessoa{db.people.length === 1 ? "" : "s"}
            </StatLink>{" "}
            ·{" "}
            <StatLink
              onClick={() => {
                setSelectedEntityId(null);
                setCurrentView("notas");
              }}
            >
              {notesThisWeek.length} nota{notesThisWeek.length === 1 ? "" : "s"} esta semana
            </StatLink>
          </span>
        </div>

        <button
          className="btn-secondary"
          onClick={() => {
            setSelectedEntityId(null);
            setCurrentView("projetos");
          }}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
          <Plus size={14} /> Novo projeto
        </button>
      </div>

      {/* QUICK CAPTURE */}
      <div
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          padding: "10px 14px",
          background: "white",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <Plus size={16} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
        <input
          ref={quickInputRef}
          type="text"
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleQuickSubmit();
            }
          }}
          placeholder="Captura rápida — escreva e classifique depois..."
          style={{
            flex: 1,
            minWidth: "200px",
            border: "none",
            outline: "none",
            fontSize: "14px",
            background: "transparent",
            color: "var(--color-text-main)",
          }}
        />

        <div style={{ display: "flex", gap: "4px" }}>
          {(["nota", "tarefa", "pessoa"] as QuickKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setQuickKind(k)}
              style={{
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 600,
                borderRadius: "999px",
                border: "none",
                cursor: "pointer",
                background: quickKind === k ? "#fde2d4" : "transparent",
                color: quickKind === k ? "#c2410c" : "var(--color-text-muted)",
                textTransform: "capitalize",
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {quickKind !== "pessoa" && db.projects.length > 0 && (
          <div style={{ position: "relative" }} ref={projectMenuRef}>
            <button
              onClick={() => setProjectMenuOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 8px",
                fontSize: "12px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--color-text-muted)",
              }}
            >
              em <strong style={{ color: "var(--color-text-main)" }}>{quickProject?.name || "Sem projeto"}</strong>
              <ChevronDown size={12} />
            </button>
            {projectMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  minWidth: "200px",
                  background: "white",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
                  zIndex: 50,
                  padding: "4px",
                }}
              >
                <button
                  onClick={() => {
                    setQuickProjectId("");
                    setProjectMenuOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: "12px",
                    borderRadius: "6px",
                  }}
                >
                  Sem projeto
                </button>
                {db.projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setQuickProjectId(p.id);
                      setProjectMenuOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      border: "none",
                      background: p.id === quickProjectId ? "#fde2d4" : "transparent",
                      cursor: "pointer",
                      fontSize: "12px",
                      borderRadius: "6px",
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {quickToast && (
          <div
            style={{
              flexBasis: "100%",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#1f8e3d",
            }}
          >
            <Check size={13} /> {quickToast}
          </div>
        )}
      </div>

      {isFirstRun ? (
        <FirstRunWelcome
          onNewProject={() => {
            setSelectedEntityId(null);
            setCurrentView("projetos");
          }}
          onCapture={() => quickInputRef.current?.focus()}
        />
      ) : (
      /* MAIN GRID: projetos (esq) + sidebar pessoas/notas (dir) */
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2.4fr) minmax(0, 1fr)",
          gap: "20px",
          alignItems: "flex-start",
        }}
      >
        {/* COLUNA ESQUERDA */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {/* HOJE */}
          {dueTodayOrOverdue.length > 0 && (
            <TodaySection
              tasks={dueTodayOrOverdue}
              overdueCount={overdueCount}
              projects={db.projects}
              today={today}
              onToggle={(t) => {
                const full = db.tasks.find((x) => x.id === t.id);
                if (full) updateTask({ ...full, completed: !full.completed });
              }}
              onOpen={(id) => {
                setSelectedEntityId(id);
                setCurrentView("tarefas");
              }}
              onSeeAll={() => setCurrentView("tarefas")}
            />
          )}

          {/* PROJETOS */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "10px",
              }}
            >
              <h2
                className="section-title"
                style={{
                  margin: 0,
                  fontSize: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Folder size={16} /> Projetos{" "}
                <span
                  style={{
                    color: "var(--color-text-muted)",
                    fontWeight: 500,
                    marginLeft: 4,
                  }}
                >
                  {db.projects.length}
                </span>
              </h2>
              <button
                className="btn-icon"
                onClick={() => setCurrentView("projetos")}
                style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
              >
                Ver todos
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: "12px",
              }}
            >
              {projectsWithMeta.map(({ proj, done, total, pct, status, latestNote }) => {
                const color = colorForProject(proj.id);
                return (
                  <div
                    key={proj.id}
                    onClick={() => goToProject(proj.id)}
                    style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "14px",
                      padding: "16px",
                      background: "white",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                      transition: "border-color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--color-text-main)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--border-color)";
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "10px",
                            background: color.bg,
                            color: color.fg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Folder size={18} />
                        </div>
                        <div
                          style={{
                            fontSize: "15px",
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {proj.name}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "10px",
                          padding: "3px 10px",
                          borderRadius: "999px",
                          background: status.bg,
                          color: status.color,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {status.label}
                      </span>
                    </div>

                    {(() => {
                      const desc = extractPlainText((proj as any).description || "", 120);
                      if (!desc) return null;
                      return (
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--color-text-muted)",
                            lineHeight: 1.45,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {desc}
                        </div>
                      );
                    })()}

                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "11px",
                          color: "var(--color-text-muted)",
                          marginBottom: "4px",
                        }}
                      >
                        <span>
                          {done} de {total} tarefas
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div
                        style={{
                          position: "relative",
                          height: "6px",
                          borderRadius: "3px",
                          background: "#eef0f3",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: `${pct}%`,
                            background: status.color,
                          }}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        borderTop: "1px solid var(--border-color)",
                        paddingTop: "10px",
                      }}
                    >
                      <div style={{ display: "flex" }}>
                        {proj.peopleIds.slice(0, 4).map((id, i) => {
                          const person = db.people.find((p) => p.id === id);
                          if (!person) return null;
                          return (
                            <div
                              key={id}
                              title={person.name}
                              style={{
                                width: "22px",
                                height: "22px",
                                borderRadius: "50%",
                                background: colorForPerson(id),
                                color: "#212529",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "10px",
                                fontWeight: 700,
                                border: "2px solid white",
                                marginLeft: i === 0 ? 0 : "-6px",
                              }}
                            >
                              {getInitials(person.name)}
                            </div>
                          );
                        })}
                      </div>
                      {latestNote && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            goToNote(latestNote.id);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            color: "var(--color-text-muted)",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "60%",
                          }}
                        >
                          <FileText size={11} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {latestNote.title || "Sem título"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Placeholder "+ Novo projeto" */}
              <button
                onClick={() => {
                  setSelectedEntityId(null);
                  setCurrentView("projetos");
                }}
                style={{
                  border: "1.5px dashed var(--border-color)",
                  borderRadius: "14px",
                  padding: "16px",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  color: "var(--color-text-muted)",
                  minHeight: "140px",
                }}
              >
                <Plus size={18} />
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Novo projeto</span>
                <span style={{ fontSize: "11px" }}>Agrupe pessoas, notas e tarefas</span>
              </button>
            </div>
          </div>

          {/* CAIXA DE ENTRADA */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "10px",
              }}
            >
              <h2
                className="section-title"
                style={{
                  margin: 0,
                  fontSize: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Inbox size={16} /> Caixa de entrada{" "}
                <span
                  style={{
                    color: "var(--color-text-muted)",
                    fontWeight: 500,
                    marginLeft: 4,
                  }}
                >
                  {inboxTasks.length} sem projeto
                </span>
              </h2>
              {inboxTasks.length > 0 && (
                <button
                  className="btn-icon"
                  onClick={() => setCurrentView("tarefas")}
                  style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
                >
                  Ver todas
                </button>
              )}
            </div>

            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                background: "white",
                padding: "4px 12px",
              }}
            >
              {inboxTasks.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                  }}
                >
                  Nenhuma tarefa sem projeto. ✨
                </div>
              ) : (
                inboxTasks.map((task) => (
                  <InboxRow
                    key={task.id}
                    task={task}
                    projects={db.projects}
                    onAssign={(pid) => handleAssignTaskToProject(task.id, pid)}
                    onOpen={() => {
                      setSelectedEntityId(task.id);
                      setCurrentView("tarefas");
                    }}
                    onToggle={async () => {
                      await updateTask({ ...task, completed: !task.completed });
                    }}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {/* PESSOAS */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "10px",
              }}
            >
              <h2
                className="section-title"
                style={{
                  margin: 0,
                  fontSize: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Users size={16} /> Pessoas
              </h2>
              <button
                className="btn-icon"
                onClick={() => setCurrentView("organograma")}
                style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
              >
                Organograma →
              </button>
            </div>
            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                background: "white",
                padding: "4px 12px",
              }}
            >
              {db.people.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                  }}
                >
                  Nenhuma pessoa cadastrada.
                </div>
              ) : (
                db.people.slice(0, 5).map((person) => (
                  <div
                    key={person.id}
                    onClick={() => goToPerson(person.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 0",
                      borderTop: "1px solid var(--border-color)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        background: colorForPerson(person.id),
                        color: "#212529",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(person.name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {person.name}
                      </div>
                      {person.role && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--color-text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {person.role}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* NOTAS RECENTES */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "10px",
              }}
            >
              <h2
                className="section-title"
                style={{
                  margin: 0,
                  fontSize: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <FileText size={16} /> Notas recentes
              </h2>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {recentNotes.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "var(--color-text-muted)",
                    fontSize: "13px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    background: "white",
                  }}
                >
                  Nenhuma nota ainda.
                </div>
              ) : (
                recentNotes.map((note) => {
                  const proj = db.projects.find((p) => p.id === note.projectId);
                  return (
                    <div
                      key={note.id}
                      onClick={() => goToNote(note.id)}
                      style={{
                        border: "1px solid var(--border-color)",
                        borderRadius: "12px",
                        background: "white",
                        padding: "12px 14px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {note.title || "Sem título"}
                        </span>
                        {note.transcript && note.transcript.trim().length > 0 && (
                          <Mic size={12} style={{ color: "#0066cc", flexShrink: 0 }} aria-label="Possui transcrição" />
                        )}
                        {note.audioFile && (
                          <Volume2 size={12} style={{ color: "#1f8e3d", flexShrink: 0 }} aria-label="Possui áudio" />
                        )}
                        {note.summaries && note.summaries.length > 0 && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "#8250df", flexShrink: 0 }}>
                            <Sparkles size={12} />
                            <span style={{ fontSize: 10, fontWeight: 700 }}>{note.summaries.length}</span>
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--color-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {proj ? proj.name : "Sem projeto"} · {relativeFromDays(note.date, today)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default Dashboard;

// ---------- Stat link (números clicáveis do cabeçalho) ----------

const StatLink: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    style={{
      background: "none",
      border: "none",
      padding: 0,
      font: "inherit",
      color: "var(--color-text-muted)",
      cursor: "pointer",
      borderBottom: "1px dashed transparent",
    }}
    onMouseEnter={(e) => {
      (e.currentTarget as HTMLElement).style.color = "var(--color-text-main)";
      (e.currentTarget as HTMLElement).style.borderBottomColor = "var(--border-color)";
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.color = "var(--color-text-muted)";
      (e.currentTarget as HTMLElement).style.borderBottomColor = "transparent";
    }}
  >
    {children}
  </button>
);

// ---------- Seção "Hoje" (tarefas vencendo hoje / atrasadas) ----------

type TodayTask = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  projectId: string | null;
};

const TodaySection: React.FC<{
  tasks: TodayTask[];
  overdueCount: number;
  projects: { id: string; name: string }[];
  today: Date;
  onToggle: (t: TodayTask) => void;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
}> = ({ tasks, overdueCount, projects, today, onToggle, onOpen, onSeeAll }) => {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const shown = tasks.slice(0, 6);
  const todayCount = tasks.length - overdueCount;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "10px",
        }}
      >
        <h2
          className="section-title"
          style={{ margin: 0, fontSize: "15px", display: "flex", alignItems: "center", gap: "6px" }}
        >
          <Calendar size={16} /> Hoje
          {overdueCount > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: "11px",
                fontWeight: 600,
                color: "#c2410c",
                background: "#fde2d4",
                borderRadius: "999px",
                padding: "2px 8px",
                marginLeft: 4,
              }}
            >
              <AlertTriangle size={11} /> {overdueCount} atrasada{overdueCount === 1 ? "" : "s"}
            </span>
          )}
          {todayCount > 0 && (
            <span style={{ color: "var(--color-text-muted)", fontWeight: 500, marginLeft: 4, fontSize: "12px" }}>
              {todayCount} para hoje
            </span>
          )}
        </h2>
        {tasks.length > shown.length && (
          <button
            className="btn-icon"
            onClick={onSeeAll}
            style={{ fontSize: "12px", color: "var(--color-text-muted)" }}
          >
            Ver todas
          </button>
        )}
      </div>

      <div
        style={{
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          background: "white",
          padding: "4px 12px",
        }}
      >
        {shown.map((t, i) => {
          const proj = projects.find((p) => p.id === t.projectId);
          const isOverdue = parseLocal(t.dueDate).getTime() < startOfToday.getTime();
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 4px",
                borderTop: i === 0 ? "none" : "1px solid var(--border-color)",
              }}
            >
              <button
                onClick={() => onToggle(t)}
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "4px",
                  border: "1.5px solid var(--border-color)",
                  background: "white",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                }}
                title="Concluir"
              />
              <button
                onClick={() => onOpen(t.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 500,
                  padding: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.title}
              </button>
              {proj && (
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--color-text-muted)",
                    background: "#eef0f3",
                    borderRadius: "999px",
                    padding: "2px 8px",
                    whiteSpace: "nowrap",
                    maxWidth: "120px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {proj.name}
                </span>
              )}
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: isOverdue ? 600 : 400,
                  color: isOverdue ? "#c2410c" : "var(--color-text-muted)",
                  minWidth: "62px",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {relativeFromDays(t.dueDate, today)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------- Estado de primeira execução ----------

const FirstRunWelcome: React.FC<{ onNewProject: () => void; onCapture: () => void }> = ({
  onNewProject,
  onCapture,
}) => {
  const items: { icon: React.ReactNode; title: string; desc: string }[] = [
    { icon: <Folder size={18} />, title: "Projetos", desc: "Agrupam notas, tarefas e pessoas de uma iniciativa." },
    { icon: <FileText size={18} />, title: "Notas de reunião", desc: "Grave o áudio, transcreva e gere sumários com IA." },
    { icon: <Users size={18} />, title: "Pessoas", desc: "Participantes das reuniões e do organograma." },
  ];
  return (
    <div
      style={{
        border: "1.5px dashed var(--border-color)",
        borderRadius: "16px",
        background: "var(--bg-sidebar)",
        padding: "40px 32px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "8px",
      }}
    >
      <div
        style={{
          width: "52px",
          height: "52px",
          borderRadius: "14px",
          background: "#fde2d4",
          color: "#c2410c",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FileText size={26} />
      </div>
      <h2 style={{ margin: "8px 0 0", fontSize: "20px", fontWeight: 800 }}>
        Bem-vindo ao Titus Notes
      </h2>
      <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-muted)", maxWidth: "440px" }}>
        Seu espaço para tomar notas em reuniões, gravar o áudio e gerar sumários com IA.
        Comece criando um projeto ou capturando uma nota rápida acima.
      </p>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", marginTop: "12px" }}>
        <button
          className="btn-primary"
          onClick={onNewProject}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
          <Plus size={14} /> Criar primeiro projeto
        </button>
        <button
          className="btn-secondary"
          onClick={onCapture}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
          <FileText size={14} /> Capturar uma nota
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "12px",
          marginTop: "24px",
          width: "100%",
          maxWidth: "640px",
        }}
      >
        {items.map((it) => (
          <div
            key={it.title}
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              background: "white",
              padding: "16px",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <span style={{ color: "var(--color-text-muted)" }}>{it.icon}</span>
            <span style={{ fontSize: "13px", fontWeight: 700 }}>{it.title}</span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
              {it.desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- Inbox row with project assignment ----------

const InboxRow: React.FC<{
  task: { id: string; title: string; dueDate: string; completed: boolean };
  projects: { id: string; name: string }[];
  onAssign: (projectId: string) => void;
  onOpen: () => void;
  onToggle: () => void;
}> = ({ task, projects, onAssign, onOpen, onToggle }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 4px",
        borderTop: "1px solid var(--border-color)",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "18px",
          height: "18px",
          borderRadius: "4px",
          border: "1.5px solid var(--border-color)",
          background: "white",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
        title="Concluir"
      />
      <button
        onClick={onOpen}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 500,
          padding: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {task.title}
      </button>

      <div style={{ position: "relative" }} ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            color: "var(--color-text-muted)",
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Atribuir a projeto <ChevronDown size={11} />
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              minWidth: "180px",
              background: "white",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              zIndex: 40,
              padding: "4px",
            }}
          >
            {projects.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--color-text-muted)" }}>
                Nenhum projeto
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onAssign(p.id);
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: "12px",
                    borderRadius: "6px",
                  }}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <span
        style={{
          fontSize: "11px",
          color: "var(--color-text-muted)",
          minWidth: "50px",
          textAlign: "right",
        }}
      >
        {formatDateShortBR(task.dueDate)}
      </span>
    </div>
  );
};
