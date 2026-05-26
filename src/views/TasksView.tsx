import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { CheckSquare, Plus, Trash2, Check, Search, X } from "lucide-react";
import { Task } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";

type EditField = "title" | "date" | "person" | "project";
interface InlineEdit {
  taskId: string;
  field: EditField;
}

// Formata YYYY-MM-DD como dd/mm/yyyy SEM passar por Date (evita bug de timezone
// onde "2026-05-21" é parseado como UTC e exibido como 20/05 em UTC-3).
const formatDateBR = (iso: string): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

export const TasksView: React.FC = () => {
  const { db, addTask, updateTask, deleteTask } = useApp();
  
  // Quick task state
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [projectId, setProjectId] = useState<string>("");
  const [personId, setPersonId] = useState<string>("");
  
  // Filter state
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Inline edit state
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [personSearch, setPersonSearch] = useState("");
  const inlineRef = useRef<HTMLDivElement>(null);

  const closeInline = () => {
    setInlineEdit(null);
    setPersonSearch("");
  };

  // Fecha edição inline ao clicar fora ou pressionar Esc
  useEffect(() => {
    if (!inlineEdit) return;
    const onClick = (e: MouseEvent) => {
      if (inlineRef.current && !inlineRef.current.contains(e.target as Node)) {
        closeInline();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInline();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [inlineEdit]);

  const startEdit = (task: Task, field: EditField) => {
    setInlineEdit({ taskId: task.id, field });
    if (field === "title") setDraftTitle(task.title);
    if (field === "person" || field === "project") setPersonSearch("");
  };

  const commitTitle = async (task: Task) => {
    const t = draftTitle.trim();
    if (t && t !== task.title) {
      await updateTask({ ...task, title: t });
    }
    closeInline();
  };

  const commitDate = async (task: Task, newDate: string) => {
    if (newDate && newDate !== task.dueDate) {
      await updateTask({ ...task, dueDate: newDate });
    }
    closeInline();
  };

  const commitPerson = async (task: Task, newPersonId: string | null) => {
    if ((task.personId || null) !== newPersonId) {
      await updateTask({ ...task, personId: newPersonId });
    }
    closeInline();
  };

  const commitProject = async (task: Task, newProjectId: string | null) => {
    if ((task.projectId || null) !== newProjectId) {
      await updateTask({ ...task, projectId: newProjectId });
    }
    closeInline();
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await addTask({
      title: title.trim(),
      completed: false,
      dueDate,
      projectId: projectId || null,
      personId: personId || null,
    });

    // Reset fields
    setTitle("");
    setProjectId("");
    setPersonId("");
  };

  const handleToggle = async (task: Task) => {
    await updateTask({
      ...task,
      completed: !task.completed,
    });
  };

  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    await deleteTask(id);
  };

  const pendingDeleteTask = pendingDeleteId
    ? db.tasks.find((t) => t.id === pendingDeleteId)
    : null;

  // Filter tasks
  const filteredTasks = db.tasks.filter((t) => {
    if (filter === "pending") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  return (
    <div className="view-container">
      {/* Header */}
      <div className="tasks-header">
        <div>
          <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <CheckSquare size={24} />
            <span>Minhas Tarefas</span>
          </h1>
          <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
            Gerencie e acompanhe seus afazeres e ações de reuniões do dia-a-dia.
          </p>
        </div>

        {/* Tab Filters */}
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            className={`btn-secondary ${filter === "all" ? "btn-primary" : ""}`}
            style={{ padding: "6px 12px", border: filter === "all" ? "none" : "1px solid var(--border-color)" }}
            onClick={() => setFilter("all")}
          >
            Todas ({db.tasks.length})
          </button>
          <button
            className={`btn-secondary ${filter === "pending" ? "btn-primary" : ""}`}
            style={{ padding: "6px 12px", border: filter === "pending" ? "none" : "1px solid var(--border-color)" }}
            onClick={() => setFilter("pending")}
          >
            Pendentes ({db.tasks.filter((t) => !t.completed).length})
          </button>
          <button
            className={`btn-secondary ${filter === "completed" ? "btn-primary" : ""}`}
            style={{ padding: "6px 12px", border: filter === "completed" ? "none" : "1px solid var(--border-color)" }}
            onClick={() => setFilter("completed")}
          >
            Concluídas ({db.tasks.filter((t) => t.completed).length})
          </button>
        </div>
      </div>

      {/* Quick Task Bar Form */}
      <form onSubmit={handleAddTask} className="quick-task-bar">
        <input
          type="text"
          className="quick-task-input"
          placeholder="Nova tarefa..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        
        {/* Due date picker */}
        <input
          type="date"
          className="quick-task-select"
          style={{ width: "130px" }}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />

        {/* Project Selector */}
        <select
          className="quick-task-select"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Sem Projeto</option>
          {db.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Person Selector */}
        <select
          className="quick-task-select"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">Sem Responsável</option>
          {db.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button type="submit" className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Plus size={14} />
          <span>Adicionar</span>
        </button>
      </form>

      {/* Tasks List */}
      <div className="task-list" style={{ backgroundColor: "#ffffff", border: "1px solid var(--border-color)", borderRadius: "var(--border-radius-lg)", padding: "8px" }}>
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => {
            const assignedPerson = db.people.find((p) => p.id === task.personId);
            const project = db.projects.find((p) => p.id === task.projectId);
            const isEditingTitle = inlineEdit?.taskId === task.id && inlineEdit.field === "title";
            const isEditingDate = inlineEdit?.taskId === task.id && inlineEdit.field === "date";
            const isEditingPerson = inlineEdit?.taskId === task.id && inlineEdit.field === "person";
            const isEditingProject = inlineEdit?.taskId === task.id && inlineEdit.field === "project";

            const editableStyle: React.CSSProperties = {
              cursor: "text",
              borderRadius: "4px",
              padding: "2px 4px",
              transition: "background 0.15s ease",
            };

            return (
              <div key={task.id} className="task-row">
                <div className="task-row-left">
                  <button type="button" className="task-checkbox-wrapper" onClick={() => handleToggle(task)}>
                    <div className={`task-checkbox ${task.completed ? "checked" : ""}`}>
                      {task.completed && <Check className="task-check-icon" />}
                    </div>
                  </button>

                  {/* Título editável inline */}
                  {isEditingTitle ? (
                    <div ref={inlineRef} style={{ flex: 1 }}>
                      <input
                        type="text"
                        className="form-input"
                        value={draftTitle}
                        autoFocus
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onBlur={() => commitTitle(task)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitTitle(task);
                          }
                        }}
                        style={{ width: "100%", fontSize: "14px", padding: "4px 8px" }}
                      />
                    </div>
                  ) : (
                    <span
                      className={`task-title ${task.completed ? "completed" : ""}`}
                      onClick={() => startEdit(task, "title")}
                      title="Clique para editar"
                      style={editableStyle}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f1f3f5")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    >
                      {task.title}
                    </span>
                  )}
                </div>

                <div className="task-row-right">
                  {/* Projeto editável inline */}
                  <div style={{ position: "relative" }}>
                    {isEditingProject ? (
                      <ProjectPicker
                        ref={inlineRef}
                        projects={db.projects}
                        currentId={task.projectId}
                        search={personSearch}
                        setSearch={setPersonSearch}
                        onPick={(pid) => commitProject(task, pid)}
                      />
                    ) : project ? (
                      <span
                        className="task-meta-tag project"
                        onClick={() => startEdit(task, "project")}
                        title="Clique para alterar projeto"
                        style={{ cursor: "pointer" }}
                      >
                        {project.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(task, "project")}
                        className="task-meta-tag"
                        style={{
                          cursor: "pointer",
                          border: "1px dashed var(--border-color)",
                          background: "transparent",
                          color: "var(--color-text-muted)",
                          fontSize: "11px",
                        }}
                        title="Adicionar projeto"
                      >
                        + projeto
                      </button>
                    )}
                  </div>

                  {/* Responsável editável inline (autocomplete) */}
                  <div style={{ position: "relative" }}>
                    {isEditingPerson ? (
                      <PersonPicker
                        ref={inlineRef}
                        people={db.people}
                        currentId={task.personId}
                        search={personSearch}
                        setSearch={setPersonSearch}
                        onPick={(pid) => commitPerson(task, pid)}
                      />
                    ) : assignedPerson ? (
                      <span
                        className="task-meta-tag person"
                        onClick={() => startEdit(task, "person")}
                        title="Clique para alterar responsável"
                        style={{ cursor: "pointer" }}
                      >
                        {assignedPerson.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(task, "person")}
                        className="task-meta-tag"
                        style={{
                          cursor: "pointer",
                          border: "1px dashed var(--border-color)",
                          background: "transparent",
                          color: "var(--color-text-muted)",
                          fontSize: "11px",
                        }}
                        title="Atribuir responsável"
                      >
                        + responsável
                      </button>
                    )}
                  </div>

                  {/* Data editável inline */}
                  {isEditingDate ? (
                    <div ref={inlineRef}>
                      <input
                        type="date"
                        className="form-input"
                        value={task.dueDate}
                        autoFocus
                        onChange={(e) => commitDate(task, e.target.value)}
                        onBlur={() => closeInline()}
                        style={{ fontSize: "12px", padding: "4px 8px" }}
                      />
                    </div>
                  ) : (
                    <span
                      className="task-due-date"
                      onClick={() => startEdit(task, "date")}
                      title="Clique para alterar a data"
                      style={{ cursor: "pointer", ...editableStyle }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f1f3f5")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    >
                      Vencimento: {formatDateBR(task.dueDate)}
                    </span>
                  )}

                  <button
                    type="button"
                    className="task-delete-btn"
                    onClick={() => handleDelete(task.id)}
                    title="Excluir tarefa"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-state" style={{ padding: "64px 0" }}>
            <CheckSquare className="empty-icon" />
            <span className="empty-text">Nenhuma tarefa encontrada neste filtro.</span>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDeleteTask}
        title="Excluir tarefa?"
        message={
          <>
            A tarefa{" "}
            <strong>{pendingDeleteTask?.title || ""}</strong> será removida
            permanentemente.
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
export default TasksView;

// ---------- Picker components ----------

interface PickerItem {
  id: string;
  name: string;
  hint?: string;
}

interface PickerProps {
  items: PickerItem[];
  currentId: string | null;
  search: string;
  setSearch: (s: string) => void;
  onPick: (id: string | null) => void;
  placeholder: string;
  emptyLabel: string;
}

const InlinePicker = React.forwardRef<HTMLDivElement, PickerProps>(function InlinePicker(
  { items, currentId, search, setSearch, onPick, placeholder, emptyLabel },
  ref,
) {
  const q = search.toLowerCase().trim();
  const filtered = q
    ? items.filter((p) => p.name.toLowerCase().includes(q) || p.hint?.toLowerCase().includes(q))
    : items;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        minWidth: "260px",
        background: "white",
        border: "1px solid var(--border-color)",
        borderRadius: "10px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
        zIndex: 100,
        padding: "6px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 8px",
          marginBottom: "4px",
          border: "1px solid var(--border-color)",
          borderRadius: "6px",
        }}
      >
        <Search size={12} style={{ color: "var(--color-text-muted)" }} />
        <input
          type="text"
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          style={{ border: "none", outline: "none", background: "transparent", fontSize: "12px", flex: 1 }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            style={{ display: "flex", padding: "2px", border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-muted)" }}
          >
            <X size={10} />
          </button>
        )}
      </div>
      <div style={{ maxHeight: "240px", overflowY: "auto" }}>
        {currentId && (
          <button
            type="button"
            onClick={() => onPick(null)}
            style={{
              display: "block",
              width: "100%",
              padding: "6px 8px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "12px",
              color: "#cf222e",
              borderRadius: "6px",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#fdecea")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            {emptyLabel}
          </button>
        )}
        {filtered.length > 0 ? (
          filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "6px 8px",
                borderRadius: "6px",
                border: "none",
                background: p.id === currentId ? "#eef4ff" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "12px",
              }}
              onMouseEnter={(e) => {
                if (p.id !== currentId) (e.currentTarget as HTMLElement).style.background = "#f1f3f5";
              }}
              onMouseLeave={(e) => {
                if (p.id !== currentId) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "11px" }}>{p.name}</div>
                {p.hint && (
                  <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>{p.hint}</div>
                )}
              </div>
            </button>
          ))
        ) : (
          <div style={{ padding: "10px", textAlign: "center", fontSize: "11px", color: "var(--color-text-muted)" }}>
            Nenhum resultado
          </div>
        )}
      </div>
    </div>
  );
});

const PersonPicker = React.forwardRef<
  HTMLDivElement,
  {
    people: { id: string; name: string; role: string }[];
    currentId: string | null;
    search: string;
    setSearch: (s: string) => void;
    onPick: (id: string | null) => void;
  }
>(function PersonPicker({ people, currentId, search, setSearch, onPick }, ref) {
  return (
    <InlinePicker
      ref={ref}
      items={people.map((p) => ({ id: p.id, name: p.name, hint: p.role }))}
      currentId={currentId}
      search={search}
      setSearch={setSearch}
      onPick={onPick}
      placeholder="Buscar pessoa..."
      emptyLabel="Remover responsável"
    />
  );
});

const ProjectPicker = React.forwardRef<
  HTMLDivElement,
  {
    projects: { id: string; name: string; description: string }[];
    currentId: string | null;
    search: string;
    setSearch: (s: string) => void;
    onPick: (id: string | null) => void;
  }
>(function ProjectPicker({ projects, currentId, search, setSearch, onPick }, ref) {
  return (
    <InlinePicker
      ref={ref}
      items={projects.map((p) => ({ id: p.id, name: p.name }))}
      currentId={currentId}
      search={search}
      setSearch={setSearch}
      onPick={onPick}
      placeholder="Buscar projeto..."
      emptyLabel="Remover projeto"
    />
  );
});
