import React, { useState, useMemo } from "react";
import { useApp } from "../context/AppContext";
import {
  Plus,
  ArrowLeft,
  FileText,
  Trash2,
  Folder,
  Check,
  MoreHorizontal,
  List as ListIcon,
  LayoutGrid,
  Search,
  ChevronDown,
  Sparkles,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { RichTextEditor } from "../components/RichTextEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ProjectChat } from "../components/ProjectChat";
import { generateSummaryWithOllama, noteToPlainText } from "../lib/ollama";
import type { ProjectStatus, AIProjectSummary } from "../types";

// --------- helpers ---------

const parseLocal = (iso: string) => {
  if (!iso) return new Date();
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const formatDayShort = (iso: string) => {
  if (!iso) return "";
  const d = parseLocal(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
};

const projectShortCode = (projects: { id: string }[], project: { id: string }) => {
  const idx = projects.findIndex((p) => p.id === project.id);
  const year = new Date().getFullYear();
  return `PROJ-${year}-${String((idx >= 0 ? idx : 0) + 1).padStart(3, "0")}`;
};

const extractNoteSnippet = (content: string, max = 140) => {
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

const noteIsThisWeek = (iso: string) => {
  const d = parseLocal(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayOfWeek = startOfToday.getDay(); // 0=dom
  const monday = new Date(startOfToday);
  monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
  return d >= monday;
};

type Tab = "overview" | "notes" | "tasks" | "people";

type StatusFilter = "all" | ProjectStatus;
type ViewMode = "list" | "grid";
type SortMode = "recentes" | "antigos" | "nome";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  "em-andamento": "Em andamento",
  "quase-la": "Quase lá",
  pausado: "Pausado",
  concluido: "Concluído",
  ideacao: "Em ideação",
};

const STATUS_COLORS: Record<ProjectStatus, { dot: string; bg: string; fg: string }> = {
  "em-andamento": { dot: "#ff8a4c", bg: "#fff3e0", fg: "#b8590a" },
  "quase-la":     { dot: "#22c55e", bg: "#e6f7ec", fg: "#1f6f3d" },
  pausado:        { dot: "#f59e0b", bg: "#fef3c7", fg: "#8a6d00" },
  concluido:      { dot: "#15161a", bg: "#eef0f3", fg: "#15161a" },
  ideacao:        { dot: "#0066cc", bg: "#e7f3ff", fg: "#0066cc" },
};

const normalizeStatus = (s: string | undefined | null): ProjectStatus =>
  (s as ProjectStatus) && STATUS_LABELS[(s as ProjectStatus)]
    ? (s as ProjectStatus)
    : "em-andamento";

const relativeTimeShort = (iso: string | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "agora";
  if (sec < 3600) return `há ${Math.round(sec / 60)} min`;
  if (sec < 86400) return `há ${Math.round(sec / 3600)} h`;
  const days = Math.round(sec / 86400);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  if (days < 30) return `há ${Math.round(days / 7)} sem`;
  if (days < 60) return "há 1 mês";
  return d.toLocaleDateString("pt-BR");
};

// --------- component ---------

export const ProjectsView: React.FC = () => {
  const {
    db,
    selectedEntityId,
    setSelectedEntityId,
    addProject,
    updateProject,
    deleteProject,
    setCurrentView,
    addNote,
    updateTask,
  } = useApp();

  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [peopleIds, setPeopleIds] = useState<string[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  // List view controls
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recentes");
  const [generatingProjectSummary, setGeneratingProjectSummary] = useState(false);
  const [projectSummaryError, setProjectSummaryError] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setName("");
    setDescription("# Novo Projeto\n\nDescreva os objetivos, pautas e informações gerais do projeto aqui...");
    setPeopleIds([]);
    setIsCreating(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await addProject({ name: name.trim(), description, peopleIds });
    setIsCreating(false);
    setSelectedEntityId(null);
  };

  const handleDescriptionChange = async (newDesc: string) => {
    if (!selectedEntityId) return;
    const project = db.projects.find((p) => p.id === selectedEntityId);
    if (project) await updateProject({ ...project, description: newDesc });
  };

  const handleNameChange = async (newName: string) => {
    if (!selectedEntityId || !newName.trim()) return;
    const project = db.projects.find((p) => p.id === selectedEntityId);
    if (project) await updateProject({ ...project, name: newName.trim() });
  };

  const handleDelete = (id: string) => setPendingDeleteId(id);
  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    await deleteProject(id);
    if (selectedEntityId === id) setSelectedEntityId(null);
  };

  const selectedProject = db.projects.find((p) => p.id === selectedEntityId);
  const pendingDeleteProject = pendingDeleteId
    ? db.projects.find((p) => p.id === pendingDeleteId)
    : null;

  const associatedNotes = useMemo(
    () =>
      selectedProject
        ? [...db.notes]
            .filter((n) => n.projectId === selectedProject.id)
            .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        : [],
    [db.notes, selectedProject?.id],
  );
  const associatedTasks = useMemo(
    () =>
      selectedProject
        ? db.tasks.filter((t) => t.projectId === selectedProject.id)
        : [],
    [db.tasks, selectedProject?.id],
  );
  const openTasks = associatedTasks.filter((t) => !t.completed);
  const doneTasks = associatedTasks.filter((t) => t.completed);

  const goToNote = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("notas");
  };
  const goToTask = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("tarefas");
  };
  const goToPerson = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("pessoas");
  };

  const handleNewNoteInProject = async () => {
    if (!selectedProject) return;
    const id = await addNote({
      title: "Nova Nota",
      content: '{"root":{"children":[{"type":"paragraph","children":[],"direction":"ltr","format":"","indent":0,"version":1}],"direction":"ltr","format":"","indent":0,"type":"root","version":1}}',
      date: new Date().toISOString().split("T")[0],
      projectId: selectedProject.id,
      peopleIds: [],
    });
    goToNote(id);
  };

  const handleToggleTask = async (id: string) => {
    const t = db.tasks.find((x) => x.id === id);
    if (t) await updateTask({ ...t, completed: !t.completed });
  };

  const buildProjectSummaryPrompt = (
    project: { name: string; description: string; status?: string | ProjectStatus },
    sources: {
      summaryBlocks: { noteTitle: string; date: string; content: string }[];
      noteBodies: { noteTitle: string; date: string; content: string }[];
      tasks: { title: string; completed: boolean; dueDate: string; assignee?: string }[];
      people: { name: string; role: string }[];
    },
  ) => {
    const lang =
      (db.settings?.language && db.settings.language) || "Português do Brasil";

    const summariesBlock = sources.summaryBlocks.length
      ? sources.summaryBlocks
          .map(
            (s, i) =>
              `--- Sumário ${i + 1} · Nota: "${s.noteTitle || "(sem título)"}" · Data: ${s.date || "n/d"} ---\n${s.content.trim()}`,
          )
          .join("\n\n")
      : "(nenhum sumário de nota disponível)";

    const noteBodiesBlock = sources.noteBodies.length
      ? sources.noteBodies
          .map(
            (n, i) =>
              `--- Anotação ${i + 1} · "${n.noteTitle || "(sem título)"}" · Data: ${n.date || "n/d"} ---\n${n.content.trim()}`,
          )
          .join("\n\n")
      : "(nenhuma anotação adicional)";

    const tasksBlock = sources.tasks.length
      ? sources.tasks
          .map(
            (t) =>
              `- [${t.completed ? "x" : " "}] ${t.title}${t.assignee ? ` (responsável: ${t.assignee})` : ""}${t.dueDate ? ` — prazo ${t.dueDate}` : ""}`,
          )
          .join("\n")
      : "(nenhuma tarefa cadastrada)";

    const peopleBlock = sources.people.length
      ? sources.people.map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ""}`).join("\n")
      : "(nenhuma pessoa alocada)";

    return `Você é um analista de projetos. Sua tarefa é gerar um RESUMO EXECUTIVO de um projeto, agregando as informações abaixo.

Idioma da resposta: ${lang}.
Formate em Markdown, usando cabeçalhos "##" para cada seção e bullet points ("- ") quando fizer sentido.
Seja factual, objetivo, e atribua datas às afirmações quando possível.

IMPORTANTE: NÃO use tabelas em Markdown (nada de "|" ou linhas com "---"). Use apenas parágrafos curtos e listas com bullets.

Projeto: ${project.name}
Status declarado: ${project.status || "—"}

Anotações da Visão Geral do projeto (descrição livre escrita pelo usuário no editor):
"""
${noteToPlainText(project.description || "").trim() || "(sem anotações na Visão Geral)"}
"""

Pessoas envolvidas:
${peopleBlock}

Tarefas do projeto (formato GitHub-style, [x] = concluída):
${tasksBlock}

Sumários das notas de reunião associadas (${sources.summaryBlocks.length} no total):

${summariesBlock}

Conteúdo bruto das anotações/notas de reunião (${sources.noteBodies.length} no total — use para preencher lacunas dos sumários e extrair detalhes específicos):

${noteBodiesBlock}

Gere o resumo agora seguindo EXATAMENTE estas seções, nesta ordem (use os mesmos títulos):

## Principais ações
Sintetize em bullets curtos as principais ações e entregas realizadas até aqui.

## Timeline
Lista de eventos em ordem cronológica. Cada item deve seguir o formato:
- **dd/mm/aaaa** — descrição muito curta do acontecimento (uma frase)
Use apenas datas que aparecem efetivamente nas fontes (notas, sumários, prazos de tarefas). Não invente datas.

## Status atual
Parágrafo curto (2-4 frases) descrevendo onde o projeto está agora: o que está em andamento, bloqueios conhecidos e nível de progresso. Cite o status declarado se relevante.

## Próximos passos
Bullets curtos com os próximos passos claros (de preferência acionáveis e atribuídos a alguém quando a fonte indicar). Inclua tarefas abertas relevantes.

Se alguma seção não tiver evidências suficientes, escreva "Sem evidências suficientes nas fontes." em vez de inventar. Responda somente em Markdown, sem comentários adicionais.`;
  };

  const handleGenerateProjectSummary = async () => {
    if (!selectedProject) return;
    setProjectSummaryError(null);

    const notesForProject = db.notes
      .filter((n) => n.projectId === selectedProject.id)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    const summaryBlocks: { noteTitle: string; date: string; content: string }[] = [];
    const noteBodies: { noteTitle: string; date: string; content: string }[] = [];
    for (const n of notesForProject) {
      for (const s of n.summaries || []) {
        if (s.content && s.content.trim()) {
          summaryBlocks.push({
            noteTitle: n.title,
            date: n.date,
            content: s.content,
          });
        }
      }
      const body = noteToPlainText(n.content || "").trim();
      if (body) {
        noteBodies.push({
          noteTitle: n.title,
          date: n.date,
          content: body,
        });
      }
    }

    const tasksForProject = db.tasks
      .filter((t) => t.projectId === selectedProject.id)
      .map((t) => ({
        title: t.title,
        completed: t.completed,
        dueDate: t.dueDate,
        assignee: t.personId
          ? db.people.find((p) => p.id === t.personId)?.name
          : undefined,
      }));

    const peopleForProject = projectPeople.map((p) => ({
      name: p.name,
      role: p.role,
    }));

    const hasDescription =
      noteToPlainText(selectedProject.description || "").trim().length > 0;

    if (
      summaryBlocks.length === 0 &&
      noteBodies.length === 0 &&
      tasksForProject.length === 0 &&
      peopleForProject.length === 0 &&
      !hasDescription
    ) {
      setProjectSummaryError(
        "Este projeto ainda não tem anotações, sumários, tarefas ou pessoas associadas para usar como fonte.",
      );
      return;
    }

    const settings = db.settings || {
      url: "http://localhost:11434",
      model: "llama3.2",
      language: "pt-BR",
    };

    setGeneratingProjectSummary(true);
    try {
      const prompt = buildProjectSummaryPrompt(selectedProject, {
        summaryBlocks,
        noteBodies,
        tasks: tasksForProject,
        people: peopleForProject,
      });
      const content = await generateSummaryWithOllama(settings, prompt);
      const aiSummary: AIProjectSummary = {
        content,
        generatedAt: new Date().toISOString(),
        model: settings.model || "llama3.2",
        sourceNoteCount: notesForProject.length,
        sourceSummaryCount: summaryBlocks.length,
        sourceTaskCount: tasksForProject.length,
        sourcePeopleCount: peopleForProject.length,
      };
      await updateProject({ ...selectedProject, aiSummary });
    } catch (err: any) {
      console.error("Erro gerando resumo do projeto:", err);
      setProjectSummaryError(err?.message || "Falha ao gerar resumo pela IA.");
    } finally {
      setGeneratingProjectSummary(false);
    }
  };

  const handleClearProjectSummary = async () => {
    if (!selectedProject) return;
    const { aiSummary, ...rest } = selectedProject;
    void aiSummary;
    await updateProject(rest as typeof selectedProject);
  };

  // ============== LIST VIEW ==============
  if (!selectedEntityId && !isCreating) {
    const counts: Record<StatusFilter, number> = {
      all: db.projects.length,
      "em-andamento": 0,
      "quase-la": 0,
      pausado: 0,
      concluido: 0,
      ideacao: 0,
    };
    for (const p of db.projects) counts[normalizeStatus(p.status)]++;

    const q = searchQuery.trim().toLowerCase();
    const filtered = db.projects.filter((p) => {
      if (statusFilter !== "all" && normalizeStatus(p.status) !== statusFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q))
        return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sort === "nome") return a.name.localeCompare(b.name);
      const ta = a.updatedAt || "";
      const tb = b.updatedAt || "";
      return sort === "recentes" ? tb.localeCompare(ta) : ta.localeCompare(tb);
    });

    // Agrupamento: 7 dias mais recentes vs resto (apenas quando ordem é "recentes")
    const recentCut = Date.now() - 7 * 86400000;
    const recents = sort === "recentes" ? sorted.filter((p) => {
      const t = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
      return t >= recentCut;
    }) : [];
    const older = sort === "recentes" ? sorted.filter((p) => !recents.includes(p)) : sorted;

    return (
      <div className="view-container projects-list-view">
        {/* Top bar */}
        <div className="proj-list-topbar">
          <div className="proj-breadcrumb">
            <Folder size={13} />
            <span style={{ fontWeight: 600, color: "#15161a" }}>Projetos</span>
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {db.projects.length} projeto{db.projects.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "26px 36px 8px", gap: "16px" }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: "var(--font-title)", fontSize: "36px", fontWeight: 800, letterSpacing: "-0.02em" }}>
              Projetos
            </h1>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--color-text-muted)" }}>
              Workspaces que agrupam suas notas, tarefas e pessoas.
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={handleOpenCreate}
            style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}
          >
            <Plus size={14} /> <span>Novo projeto</span>
          </button>
        </div>

        {/* Controls bar */}
        <div className="proj-list-controls">
          {/* View toggle */}
          <div className="proj-view-toggle">
            <button
              className={`proj-view-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title="Lista"
            >
              <ListIcon size={13} /> Lista
            </button>
            <button
              className={`proj-view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grade"
            >
              <LayoutGrid size={13} /> Grade
            </button>
          </div>

          {/* Status filters */}
          <div className="proj-status-filters">
            <button
              className={`proj-status-chip ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              Todos <span className="proj-chip-count">{counts.all}</span>
            </button>
            {(["em-andamento", "quase-la", "pausado", "concluido"] as ProjectStatus[]).map((s) => (
              <button
                key={s}
                className={`proj-status-chip ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                <span className="proj-status-dot" style={{ background: STATUS_COLORS[s].dot }} />
                {STATUS_LABELS[s]}{" "}
                <span className="proj-chip-count">{counts[s]}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="proj-search">
            <Search size={12} />
            <input
              type="text"
              placeholder="Buscar projeto..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="proj-search-clear">×</button>
            )}
          </div>

          {/* Sort */}
          <div className="proj-sort">
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
              <option value="recentes">Ordem: recentes</option>
              <option value="antigos">Ordem: antigos</option>
              <option value="nome">Ordem: nome</option>
            </select>
            <ChevronDown size={12} />
          </div>
        </div>

        {/* Content */}
        <div className="proj-list-content">
          {sorted.length === 0 ? (
            <div className="proj-empty-state">
              Nenhum projeto encontrado com os filtros atuais.
            </div>
          ) : viewMode === "grid" ? (
            <ProjectsGrid
              projects={sorted}
              db={db}
              onOpen={(id) => {
                setSelectedEntityId(id);
                setTab("overview");
              }}
              onDelete={handleDelete}
            />
          ) : (
            <ProjectsTable
              recents={recents}
              older={sort === "recentes" ? older : sorted}
              showGrouping={sort === "recentes"}
              db={db}
              onOpen={(id) => {
                setSelectedEntityId(id);
                setTab("overview");
              }}
              onDelete={handleDelete}
            />
          )}
        </div>

        <ConfirmDialog
          open={!!pendingDeleteProject}
          title="Excluir projeto?"
          message={
            <>
              <strong>{pendingDeleteProject?.name || ""}</strong> será removido.
              Notas e tarefas associadas continuarão existindo, mas perderão a vinculação.
            </>
          }
          confirmLabel="Excluir"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteId(null)}
        />
      </div>
    );
  }

  // ============== CREATE VIEW ==============
  if (isCreating) {
    return (
      <div className="view-container">
        <button className="btn-secondary" style={{ marginBottom: "20px" }} onClick={() => setIsCreating(false)}>
          <ArrowLeft size={12} style={{ marginRight: "4px" }} /> Voltar
        </button>
        <div className="pane-card" style={{ maxWidth: "700px", margin: "0 auto" }}>
          <h2 className="pane-title">Criar Novo Projeto</h2>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Nome do Projeto</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex. Watson X - Migration"
                required
              />
            </div>
            <div className="form-group">
              <label>Alocação de Integrantes</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", border: "1px solid var(--border-color)", padding: "12px", borderRadius: "var(--border-radius-md)", maxHeight: "150px", overflowY: "auto" }}>
                {db.people.map((p) => {
                  const isChecked = peopleIds.includes(p.id);
                  return (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", background: isChecked ? "var(--bg-active-sidebar)" : "var(--bg-sidebar)", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setPeopleIds(isChecked ? peopleIds.filter((id) => id !== p.id) : [...peopleIds, p.id]);
                        }}
                      />
                      <span>{p.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="form-group">
              <label>Descrição do Projeto</label>
              <RichTextEditor value={description} onChange={setDescription} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary">
                Criar Projeto
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ============== DETAIL VIEW ==============
  if (!selectedProject) return null;
  const shortCode = projectShortCode(db.projects, selectedProject);

  const projectPeople = selectedProject.peopleIds
    .map((id) => db.people.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <div className="view-container project-detail">
      {/* TOP BAR — breadcrumb + ações */}
      <div className="proj-topbar">
        <div className="proj-breadcrumb">
          <button className="proj-crumb-back" onClick={() => setSelectedEntityId(null)}>
            <Folder size={13} />
            <span>Projetos</span>
          </button>
          <span className="proj-crumb-sep">/</span>
          <span className="proj-crumb-current">{selectedProject.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Status selector */}
          {(() => {
            const cur = normalizeStatus(selectedProject.status);
            const c = STATUS_COLORS[cur];
            return (
              <div className="proj-status-select-wrap" style={{ background: c.bg, color: c.fg }}>
                <span className="proj-status-dot" style={{ background: c.dot }} />
                <select
                  value={cur}
                  onChange={async (e) => {
                    const next = e.target.value as ProjectStatus;
                    await updateProject({ ...selectedProject, status: next });
                  }}
                  className="proj-status-select"
                >
                  {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </div>
            );
          })()}
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {relativeTimeShort(selectedProject.updatedAt)}
          </span>
          <button
            className="btn-secondary"
            onClick={handleGenerateProjectSummary}
            disabled={generatingProjectSummary}
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
            title="Gerar resumo IA agregando sumários de notas, tarefas e pessoas do projeto"
          >
            {generatingProjectSummary ? (
              <>
                <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
                Gerando…
              </>
            ) : selectedProject.aiSummary ? (
              <>
                <RefreshCw size={12} /> Regenerar resumo
              </>
            ) : (
              <>
                <Sparkles size={12} /> Resumo IA
              </>
            )}
          </button>
          <button
            className="btn-secondary"
            onClick={handleNewNoteInProject}
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
          >
            <Plus size={12} /> Nova nota
          </button>
          <button
            className="btn-icon"
            title="Excluir projeto"
            onClick={() => handleDelete(selectedProject.id)}
            style={{ color: "var(--color-text-muted)" }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* HEADER — ID, título, tags */}
      <div className="proj-header">
        <div className="proj-id-badge">
          <Folder size={16} />
        </div>
        <div className="proj-id-text">{shortCode}</div>
        <input
          type="text"
          className="proj-title"
          value={selectedProject.name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Nome do projeto..."
        />
      </div>

      {/* TABS */}
      <div className="proj-tabs">
        <button
          className={`proj-tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Visão geral
        </button>
        <button
          className={`proj-tab ${tab === "notes" ? "active" : ""}`}
          onClick={() => setTab("notes")}
        >
          Notas <span className="proj-tab-count">{associatedNotes.length}</span>
        </button>
        <button
          className={`proj-tab ${tab === "tasks" ? "active" : ""}`}
          onClick={() => setTab("tasks")}
        >
          Tarefas <span className="proj-tab-count">{associatedTasks.length}</span>
        </button>
        <button
          className={`proj-tab ${tab === "people" ? "active" : ""}`}
          onClick={() => setTab("people")}
        >
          Pessoas <span className="proj-tab-count">{projectPeople.length}</span>
        </button>
      </div>

      {/* CONTENT */}
      <div className="proj-content">
        {tab === "overview" && (
          <div className="proj-overview">
            {/* AI Summary card */}
            {(selectedProject.aiSummary || projectSummaryError || generatingProjectSummary) && (
              <div className="proj-ai-summary-card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
                    <Sparkles size={14} style={{ color: "#8250df" }} />
                    <span>Resumo IA do projeto</span>
                    {selectedProject.aiSummary && (
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-muted)" }}>
                        · {selectedProject.aiSummary.sourceSummaryCount} sumário
                        {selectedProject.aiSummary.sourceSummaryCount === 1 ? "" : "s"} ·{" "}
                        {selectedProject.aiSummary.sourceTaskCount} tarefa
                        {selectedProject.aiSummary.sourceTaskCount === 1 ? "" : "s"} ·{" "}
                        {selectedProject.aiSummary.sourcePeopleCount} pessoa
                        {selectedProject.aiSummary.sourcePeopleCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {selectedProject.aiSummary && !generatingProjectSummary && (
                    <button
                      className="btn-secondary"
                      onClick={handleClearProjectSummary}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        padding: "4px 8px",
                        color: "#cf222e",
                        borderColor: "#cf222e22",
                      }}
                      title="Remover resumo gerado"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {projectSummaryError && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: "8px 10px",
                      borderRadius: 6,
                      backgroundColor: "#fdecea",
                      color: "#cf222e",
                      fontSize: 12,
                      marginBottom: selectedProject.aiSummary ? 10 : 0,
                    }}
                  >
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{projectSummaryError}</span>
                  </div>
                )}

                {generatingProjectSummary && !selectedProject.aiSummary && (
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    Agregando sumários, tarefas e pessoas… isso pode levar alguns segundos.
                  </div>
                )}

                {selectedProject.aiSummary && (
                  <>
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                      <MarkdownRenderer content={selectedProject.aiSummary.content} />
                    </div>
                    <div
                      style={{
                        marginTop: 10,
                        paddingTop: 8,
                        borderTop: "1px dashed #e8defc",
                        fontSize: 10,
                        color: "var(--color-text-muted)",
                        display: "flex",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 4,
                      }}
                    >
                      <span>
                        Gerado em{" "}
                        {new Date(selectedProject.aiSummary.generatedAt).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <span>modelo: {selectedProject.aiSummary.model}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <RichTextEditor
              key={selectedProject.id}
              value={selectedProject.description}
              onChange={handleDescriptionChange}
            />
          </div>
        )}

        {tab === "notes" && (
          <ProjectNotesTab
            notes={associatedNotes}
            onOpenNote={goToNote}
            onNewNote={handleNewNoteInProject}
          />
        )}

        {tab === "tasks" && (
          <ProjectTasksTab
            open={openTasks}
            done={doneTasks}
            allPeople={db.people}
            onToggle={handleToggleTask}
            onOpenTask={goToTask}
            onOpenPerson={goToPerson}
          />
        )}

        {tab === "people" && (
          <ProjectPeopleTab
            people={projectPeople}
            allNotes={associatedNotes}
            onOpenPerson={goToPerson}
            onOpenNote={goToNote}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDeleteProject}
        title="Excluir projeto?"
        message={
          <>
            <strong>{pendingDeleteProject?.name || ""}</strong> será removido.
            Notas e tarefas associadas continuarão existindo, mas perderão a vinculação.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />

      <ProjectChat
        project={selectedProject}
        notes={associatedNotes}
        tasks={associatedTasks}
        people={projectPeople}
        settings={db.settings || { url: "http://localhost:11434", model: "llama3.2", language: "pt-BR" }}
      />
    </div>
  );
};

export default ProjectsView;

// ============== SUB-COMPONENTES POR TAB ==============

const ProjectNotesTab: React.FC<{
  notes: { id: string; title: string; content: string; date: string }[];
  onOpenNote: (id: string) => void;
  onNewNote: () => void | Promise<void>;
}> = ({ notes, onOpenNote, onNewNote }) => {
  const thisWeek = notes.filter((n) => noteIsThisWeek(n.date));
  const older = notes.filter((n) => !noteIsThisWeek(n.date));

  const renderGroup = (label: string, items: typeof notes) => {
    if (items.length === 0) return null;
    return (
      <div className="proj-notes-group">
        <div className="proj-section-label">{label}</div>
        {items.map((n) => (
          <button key={n.id} className="proj-note-row" onClick={() => onOpenNote(n.id)}>
            <FileText size={14} className="proj-note-icon" />
            <div className="proj-note-body">
              <div className="proj-note-title">{n.title || "Sem título"}</div>
              <div className="proj-note-snippet">
                {extractNoteSnippet(n.content) || "Sem conteúdo"}
              </div>
            </div>
            <div className="proj-note-date">{formatDayShort(n.date)}</div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="proj-notes">
      {notes.length === 0 ? (
        <div className="proj-empty-state">Nenhuma nota vinculada ainda.</div>
      ) : (
        <>
          {renderGroup("ESTA SEMANA", thisWeek)}
          {renderGroup("MAIS ANTIGAS", older)}
        </>
      )}
      <button className="proj-add-row" onClick={() => onNewNote()}>
        <Plus size={14} /> Nova nota neste projeto
      </button>
    </div>
  );
};

const ProjectTasksTab: React.FC<{
  open: { id: string; title: string; dueDate: string; personId: string | null }[];
  done: { id: string; title: string; dueDate: string; personId: string | null }[];
  allPeople: { id: string; name: string; avatarUrl?: string }[];
  onToggle: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenPerson: (id: string) => void;
}> = ({ open, done, allPeople, onToggle, onOpenTask, onOpenPerson }) => {
  const renderTask = (t: { id: string; title: string; dueDate: string; personId: string | null }, completed: boolean) => {
    const person = t.personId ? allPeople.find((p) => p.id === t.personId) : null;
    const initials = person ? person.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() : "";
    return (
      <div key={t.id} className={`proj-task-row ${completed ? "completed" : ""}`}>
        <button
          className="proj-task-check"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(t.id);
          }}
          aria-label={completed ? "Reabrir tarefa" : "Concluir tarefa"}
        >
          {completed && <Check size={11} />}
        </button>
        <span className="proj-task-title" onClick={() => onOpenTask(t.id)}>
          {t.title}
        </span>
        <div className="proj-task-meta">
          {person && (
            <button
              className="proj-task-person"
              title={person.name}
              onClick={(e) => {
                e.stopPropagation();
                onOpenPerson(person.id);
              }}
            >
              {person.avatarUrl ? (
                <img src={person.avatarUrl} alt={person.name} />
              ) : (
                <span>{initials}</span>
              )}
            </button>
          )}
          <span className="proj-task-date">
            {completed ? "concluída" : formatDayShort(t.dueDate)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="proj-tasks">
      <div className="proj-section-label">EM ABERTO · {open.length}</div>
      {open.length === 0 ? (
        <div className="proj-empty-state-sm">Nenhuma tarefa em aberto.</div>
      ) : (
        open.map((t) => renderTask(t, false))
      )}

      {done.length > 0 && (
        <>
          <div className="proj-section-label" style={{ marginTop: "20px" }}>
            CONCLUÍDAS · {done.length}
          </div>
          {done.map((t) => renderTask(t, true))}
        </>
      )}

      <button className="proj-add-row" onClick={() => alert("Adicione a tarefa em Tarefas")}>
        <Plus size={14} /> Adicionar tarefa
      </button>
    </div>
  );
};

const ProjectPeopleTab: React.FC<{
  people: { id: string; name: string; role: string; avatarUrl?: string }[];
  allNotes: { id: string; title: string; peopleIds: string[] }[];
  onOpenPerson: (id: string) => void;
  onOpenNote: (id: string) => void;
}> = ({ people, allNotes, onOpenPerson, onOpenNote }) => {
  return (
    <div className="proj-people">
      <div className="proj-people-hint">
        Pessoas são derivadas automaticamente das notas associadas a este projeto.
        Para adicionar alguém, mencione-a como participante em uma nota.
      </div>

      {people.length === 0 ? (
        <div className="proj-empty-state">
          Nenhuma pessoa vinculada — ainda não há notas com participantes neste projeto.
        </div>
      ) : (
        <div className="proj-people-grid">
          {people.map((p) => {
            const initials =
              p.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "?";
            const notesWithThisPerson = allNotes.filter((n) =>
              n.peopleIds.includes(p.id),
            );
            return (
              <div key={p.id} className="proj-person-card">
                <button
                  className="proj-person-card-main"
                  onClick={() => onOpenPerson(p.id)}
                >
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt={p.name} className="proj-person-avatar" />
                  ) : (
                    <span className="proj-person-avatar">{initials}</span>
                  )}
                  <span className="proj-person-info">
                    <span className="proj-person-name">{p.name}</span>
                    {p.role && <span className="proj-person-role">{p.role}</span>}
                    <span className="proj-person-notes-count">
                      {notesWithThisPerson.length} nota
                      {notesWithThisPerson.length === 1 ? "" : "s"} neste projeto
                    </span>
                  </span>
                </button>
                {notesWithThisPerson.length > 0 && (
                  <div className="proj-person-notes">
                    {notesWithThisPerson.slice(0, 3).map((n) => (
                      <button
                        key={n.id}
                        className="proj-person-note-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenNote(n.id);
                        }}
                        title={n.title}
                      >
                        {n.title || "Sem título"}
                      </button>
                    ))}
                    {notesWithThisPerson.length > 3 && (
                      <span className="proj-person-note-more">
                        +{notesWithThisPerson.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============== LIST/GRID DA PÁGINA INICIAL ==============

type ProjectLike = {
  id: string;
  name: string;
  description: string;
  peopleIds: string[];
  status?: string;
  updatedAt?: string;
};

const initialsOf = (name: string) =>
  name.split(" ").map((s) => s[0] || "").join("").slice(0, 2).toUpperCase();

const PeopleStack: React.FC<{
  peopleIds: string[];
  allPeople: { id: string; name: string; avatarUrl?: string }[];
  max?: number;
}> = ({ peopleIds, allPeople, max = 3 }) => {
  const shown = peopleIds.slice(0, max);
  const extra = peopleIds.length - shown.length;
  return (
    <div className="proj-people-stack">
      {shown.map((pid, i) => {
        const p = allPeople.find((x) => x.id === pid);
        if (!p) return null;
        return (
          <span
            key={pid}
            className="proj-stack-avatar"
            title={p.name}
            style={{ zIndex: max - i, marginLeft: i === 0 ? 0 : -8 }}
          >
            {p.avatarUrl ? <img src={p.avatarUrl} alt={p.name} /> : initialsOf(p.name)}
          </span>
        );
      })}
      {extra > 0 && (
        <span className="proj-stack-extra" style={{ marginLeft: -8 }}>
          +{extra}
        </span>
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = normalizeStatus(status);
  const c = STATUS_COLORS[s];
  return (
    <span className="proj-status-badge" style={{ background: c.bg, color: c.fg }}>
      <span className="proj-status-dot" style={{ background: c.dot }} />
      {STATUS_LABELS[s].toUpperCase()}
    </span>
  );
};

const ProjectsTable: React.FC<{
  recents: ProjectLike[];
  older: ProjectLike[];
  showGrouping: boolean;
  db: { notes: { projectId: string | null }[]; tasks: { projectId: string | null; completed: boolean }[]; people: { id: string; name: string; avatarUrl?: string }[] };
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ recents, older, showGrouping, db, onOpen, onDelete }) => {
  const renderRow = (project: ProjectLike) => {
    const notesCount = db.notes.filter((n) => n.projectId === project.id).length;
    const projTasks = db.tasks.filter((t) => t.projectId === project.id);
    const done = projTasks.filter((t) => t.completed).length;
    const total = projTasks.length;
    const snippet = extractNoteSnippet(project.description, 80);

    return (
      <div
        key={project.id}
        className="proj-row"
        onClick={() => onOpen(project.id)}
      >
        <div className="proj-row-icon">
          <Folder size={14} />
        </div>
        <div className="proj-row-name">
          <div className="proj-row-title">{project.name}</div>
          <div className="proj-row-snippet">{snippet || "Sem descrição"}</div>
        </div>
        <div className="proj-row-col">
          <StatusBadge status={project.status || ""} />
        </div>
        <div className="proj-row-col proj-row-num">
          <FileText size={11} style={{ opacity: 0.5, marginRight: 4 }} />
          {notesCount}
        </div>
        <div className="proj-row-col proj-row-num">
          {done}/{total}
        </div>
        <div className="proj-row-col">
          <PeopleStack peopleIds={project.peopleIds} allPeople={db.people} />
        </div>
        <div className="proj-row-col proj-row-edited">
          {relativeTimeShort(project.updatedAt)}
        </div>
        <button
          className="proj-row-del"
          title="Excluir projeto"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  };

  return (
    <div className="proj-table">
      {/* Header */}
      <div className="proj-row proj-row-header">
        <div />
        <div>PROJETO</div>
        <div>STATUS</div>
        <div className="proj-row-num">NOTAS</div>
        <div className="proj-row-num">TAREFAS</div>
        <div>PESSOAS</div>
        <div className="proj-row-edited">EDITADO</div>
        <div />
      </div>

      {showGrouping ? (
        <>
          {recents.length > 0 && (
            <>
              <div className="proj-group-label">
                <span>RECENTES</span>
                <span className="proj-group-count">{recents.length}</span>
              </div>
              {recents.map(renderRow)}
            </>
          )}
          {older.length > 0 && (
            <>
              <div className="proj-group-label">
                <span>MAIS ANTIGOS</span>
                <span className="proj-group-count">{older.length}</span>
              </div>
              {older.map(renderRow)}
            </>
          )}
        </>
      ) : (
        older.map(renderRow)
      )}
    </div>
  );
};

const ProjectsGrid: React.FC<{
  projects: ProjectLike[];
  db: { notes: { projectId: string | null }[]; tasks: { projectId: string | null; completed: boolean }[]; people: { id: string; name: string; avatarUrl?: string }[] };
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ projects, db, onOpen, onDelete }) => {
  return (
    <div className="projects-grid">
      {projects.map((project) => {
        const notesCount = db.notes.filter((n) => n.projectId === project.id).length;
        const tasksCount = db.tasks.filter((t) => t.projectId === project.id && !t.completed).length;
        return (
          <div
            key={project.id}
            className="project-card"
            onClick={() => onOpen(project.id)}
            style={{ position: "relative" }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(project.id);
              }}
              title="Excluir projeto"
              className="btn-icon"
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                color: "#cf222e",
                opacity: 0.6,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.6")}
            >
              <Trash2 size={14} />
            </button>
            <div style={{ marginBottom: "8px" }}>
              <StatusBadge status={project.status || ""} />
            </div>
            <h3 className="project-card-title">{project.name}</h3>
            <p className="project-card-desc">
              {extractNoteSnippet(project.description, 120) || "Sem descrição..."}
            </p>
            <div className="project-card-meta">
              <span>
                {notesCount} notas • {tasksCount} pendentes
              </span>
              <PeopleStack peopleIds={project.peopleIds} allPeople={db.people} max={4} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
