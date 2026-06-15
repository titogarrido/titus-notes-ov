import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  CheckSquare,
  CalendarDays,
  AlertTriangle,
  Plus,
  X,
} from "lucide-react";

type FilterMode = "all" | "notes" | "tasks" | "open-tasks";

export const CalendarView: React.FC = () => {
  const { db, setCurrentView, setSelectedEntityId, addNote, addTask } = useApp();
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [currentDate, setCurrentDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [filter, setFilter] = useState<FilterMode>("all");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const handlePrevYear = () => setCurrentDate(new Date(year - 1, month, 1));
  const handleNextYear = () => setCurrentDate(new Date(year + 1, month, 1));
  const handleToday = () =>
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));

  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dayCells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) dayCells.push(null);
  for (let i = 1; i <= daysInMonth; i++) dayCells.push(i);
  // Pad trailing cells to complete the final week (keeps grid heights consistent)
  while (dayCells.length % 7 !== 0) dayCells.push(null);

  const fmtDay = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const showNotes = filter === "all" || filter === "notes";
  const showTasks = filter === "all" || filter === "tasks" || filter === "open-tasks";

  const getItemsForDay = (day: number) => {
    const key = fmtDay(day);
    const dayNotes = showNotes ? db.notes.filter((n) => n.date === key) : [];
    const dayTasks = showTasks
      ? db.tasks.filter(
          (t) =>
            t.dueDate === key && (filter !== "open-tasks" || !t.completed),
        )
      : [];
    return { notes: dayNotes, tasks: dayTasks };
  };

  // Month-wide counters
  const monthStats = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const notes = db.notes.filter((n) => (n.date || "").startsWith(prefix)).length;
    const tasksInMonth = db.tasks.filter((t) => (t.dueDate || "").startsWith(prefix));
    const openTasks = tasksInMonth.filter((t) => !t.completed).length;
    const overdueTasks = db.tasks.filter(
      (t) =>
        !t.completed &&
        t.dueDate &&
        new Date(t.dueDate) < startOfToday &&
        (t.dueDate || "").startsWith(prefix),
    ).length;
    return { notes, tasks: tasksInMonth.length, openTasks, overdueTasks };
  }, [db.notes, db.tasks, year, month, startOfToday]);

  const handleNoteClick = (id: string) => {
    setSelectedEntityId(id);
    setCurrentView("notas");
  };

  const handleTaskClick = () => {
    setSelectedEntityId(null);
    setCurrentView("tarefas");
  };

  const handleNewNoteOnDay = async (day: number) => {
    const id = await addNote({
      title: "Nova Nota",
      content: "",
      date: fmtDay(day),
      projectId: null,
      peopleIds: [],
    });
    setOpenDay(null);
    if (id) {
      setSelectedEntityId(id);
      setCurrentView("notas");
    }
  };

  const handleNewTaskOnDay = async (day: number) => {
    const title = newTaskTitle.trim();
    if (!title) return;
    await addTask({
      title,
      completed: false,
      dueDate: fmtDay(day),
      projectId: null,
      personId: null,
    });
    setNewTaskTitle("");
  };

  const MAX_VISIBLE_PER_DAY = 3;

  return (
    <div className="view-container" style={{ maxWidth: "1100px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: "20px", flexWrap: "wrap" }}>
        <div>
          <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Calendar size={24} />
            <span>Calendário</span>
          </h1>
          <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
            Visualize suas anotações e tarefas distribuídas pelo tempo.
          </p>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: "var(--color-text-muted)", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <FileText size={12} /> {monthStats.notes} nota{monthStats.notes === 1 ? "" : "s"}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <CheckSquare size={12} /> {monthStats.openTasks} aberta{monthStats.openTasks === 1 ? "" : "s"} de {monthStats.tasks}
            </span>
            {monthStats.overdueTasks > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#cf222e", fontWeight: 600 }}>
                <AlertTriangle size={12} /> {monthStats.overdueTasks} atrasada{monthStats.overdueTasks === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={handleToday}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 34 }}
            title="Ir para o mês atual"
          >
            <CalendarDays size={13} />
            <span>Hoje</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-sidebar)", padding: "4px 8px", borderRadius: "var(--border-radius-md)", border: "1px solid var(--border-color)" }}>
            <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={handlePrevYear} title="Ano anterior">
              <ChevronsLeft size={14} />
            </button>
            <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={handlePrevMonth} title="Mês anterior">
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, minWidth: 130, textAlign: "center" }}>
              {monthNames[month]} {year}
            </span>
            <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={handleNextMonth} title="Próximo mês">
              <ChevronRight size={14} />
            </button>
            <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={handleNextYear} title="Próximo ano">
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {([
          { id: "all", label: "Tudo" },
          { id: "notes", label: "Só notas" },
          { id: "tasks", label: "Só tarefas" },
          { id: "open-tasks", label: "Tarefas pendentes" },
        ] as { id: FilterMode; label: string }[]).map((opt) => {
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className="btn-secondary"
              style={{
                height: 28,
                padding: "0 12px",
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                backgroundColor: active ? "var(--bg-active-sidebar)" : undefined,
                borderColor: active ? "var(--accent-orange)" : undefined,
                color: active ? "var(--accent-orange)" : undefined,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Grid Container */}
      <div style={{ backgroundColor: "#ffffff", border: "1px solid var(--border-color)", borderRadius: "var(--border-radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        {/* Weekday labels */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border-color)", backgroundColor: "var(--bg-sidebar)", textAlign: "center", padding: "8px 0" }}>
          {weekDays.map((d, i) => (
            <span
              key={d}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: i === 0 || i === 6 ? "var(--accent-orange)" : "var(--color-text-muted)",
                textTransform: "uppercase",
              }}
            >
              {d}
            </span>
          ))}
        </div>

        {/* Days grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "120px" }}>
          {dayCells.map((day, idx) => {
            const isWeekend = idx % 7 === 0 || idx % 7 === 6;
            if (day === null) {
              return (
                <div
                  key={`empty-${idx}`}
                  style={{
                    backgroundColor: "#fafaf9",
                    borderRight: "1px solid var(--border-color)",
                    borderBottom: "1px solid var(--border-color)",
                  }}
                />
              );
            }

            const { notes: dayNotes, tasks: dayTasks } = getItemsForDay(day);
            const cellDate = new Date(year, month, day);
            const isToday =
              today.getDate() === day &&
              today.getMonth() === month &&
              today.getFullYear() === year;
            const isPast = cellDate < startOfToday && !isToday;

            const items: Array<{
              kind: "note" | "task";
              id: string;
              title: string;
              completed?: boolean;
              overdue?: boolean;
            }> = [
              ...dayNotes.map((n) => ({ kind: "note" as const, id: n.id, title: n.title })),
              ...dayTasks.map((t) => ({
                kind: "task" as const,
                id: t.id,
                title: t.title,
                completed: t.completed,
                overdue: !t.completed && isPast,
              })),
            ];

            const visible = items.slice(0, MAX_VISIBLE_PER_DAY);
            const hidden = items.length - visible.length;

            return (
              <div
                key={`day-${day}`}
                className="calendar-day-cell"
                onClick={() => setOpenDay(day)}
                title={`${day}/${month + 1} — clique para ver e adicionar`}
                style={{
                  padding: "6px 7px",
                  borderRight: "1px solid var(--border-color)",
                  borderBottom: "1px solid var(--border-color)",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  overflow: "hidden",
                  cursor: "pointer",
                  backgroundColor: isToday
                    ? "#fff7e6"
                    : isWeekend
                      ? "#fafafa"
                      : "#ffffff",
                }}
              >
                {/* Day label */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday
                        ? "#ffffff"
                        : isPast
                          ? "var(--color-text-muted)"
                          : "var(--color-text-main)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 22,
                      height: 22,
                      padding: "0 6px",
                      borderRadius: 11,
                      backgroundColor: isToday ? "var(--accent-orange)" : "transparent",
                    }}
                  >
                    {day}
                  </span>
                  {items.length > 0 && (
                    <span style={{ fontSize: 9, color: "var(--color-text-muted)", fontWeight: 600 }}>
                      {items.length}
                    </span>
                  )}
                </div>

                {/* Events */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minHeight: 0 }}>
                  {visible.map((it) => {
                    if (it.kind === "note") {
                      return (
                        <button
                          key={`n-${it.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNoteClick(it.id);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            background: "var(--bg-badge-orange)",
                            color: "var(--color-badge-orange)",
                            padding: "2px 5px",
                            borderRadius: 3,
                            fontSize: 10,
                            fontWeight: 600,
                            textAlign: "left",
                            width: "100%",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            border: "none",
                            cursor: "pointer",
                          }}
                          title={`Nota: ${it.title}`}
                        >
                          <FileText size={9} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
                        </button>
                      );
                    }
                    const bg = it.completed
                      ? "var(--bg-badge-gray)"
                      : it.overdue
                        ? "#fdecea"
                        : "var(--bg-badge-blue)";
                    const fg = it.completed
                      ? "var(--color-text-muted)"
                      : it.overdue
                        ? "#cf222e"
                        : "var(--color-badge-blue)";
                    return (
                      <button
                        key={`t-${it.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTaskClick();
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          background: bg,
                          color: fg,
                          padding: "2px 5px",
                          borderRadius: 3,
                          fontSize: 10,
                          fontWeight: 600,
                          textAlign: "left",
                          width: "100%",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          textDecoration: it.completed ? "line-through" : "none",
                          border: "none",
                          cursor: "pointer",
                        }}
                        title={`Tarefa${it.overdue ? " (atrasada)" : ""}: ${it.title}`}
                      >
                        {it.overdue ? (
                          <AlertTriangle size={9} style={{ flexShrink: 0 }} />
                        ) : (
                          <CheckSquare size={9} style={{ flexShrink: 0 }} />
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
                      </button>
                    );
                  })}
                  {hidden > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDay(day);
                      }}
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-muted)",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                        padding: "1px 4px",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                      title="Ver todos os itens deste dia"
                    >
                      +{hidden} mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "var(--color-text-muted)", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--bg-badge-orange)" }} />
          Nota
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--bg-badge-blue)" }} />
          Tarefa
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fdecea" }} />
          Tarefa atrasada
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--bg-badge-gray)" }} />
          Concluída
        </span>
      </div>

      {/* Popover/modal do dia: ver itens + adicionar nota/tarefa na data */}
      {openDay !== null && (() => {
        const { notes: dayNotes, tasks: dayTasks } = (() => {
          const key = fmtDay(openDay);
          return {
            notes: db.notes.filter((n) => n.date === key),
            tasks: db.tasks.filter((t) => t.dueDate === key),
          };
        })();
        return (
          <div
            className="modal-overlay"
            onClick={() => {
              setOpenDay(null);
              setNewTaskTitle("");
            }}
          >
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 460, width: "100%", padding: 0, overflow: "hidden" }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border-color)",
                }}
              >
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  <Calendar size={16} />
                  {openDay} de {monthNames[month]} {year}
                </h3>
                <button
                  className="btn-icon"
                  onClick={() => {
                    setOpenDay(null);
                    setNewTaskTitle("");
                  }}
                  title="Fechar"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Ações de criação */}
              <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--border-color)" }}>
                <button
                  className="btn-secondary"
                  onClick={() => handleNewNoteOnDay(openDay)}
                  style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
                >
                  <FileText size={14} /> Nova nota nesta data
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleNewTaskOnDay(openDay);
                  }}
                  style={{ display: "flex", gap: 6 }}
                >
                  <input
                    type="text"
                    className="form-input"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Nova tarefa para este dia…"
                    autoFocus
                    style={{ flex: 1, height: 34, fontSize: 13 }}
                  />
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={!newTaskTitle.trim()}
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                    title="Adicionar tarefa"
                  >
                    <Plus size={14} />
                  </button>
                </form>
              </div>

              {/* Itens do dia */}
              <div style={{ maxHeight: 320, overflowY: "auto", padding: "8px 10px" }}>
                {dayNotes.length === 0 && dayTasks.length === 0 ? (
                  <div style={{ padding: "20px", textAlign: "center", fontSize: 13, color: "var(--color-text-muted)" }}>
                    Nada agendado neste dia ainda.
                  </div>
                ) : (
                  <>
                    {dayNotes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleNoteClick(n.id)}
                        style={dayItemStyle}
                      >
                        <FileText size={14} style={{ color: "var(--color-badge-orange)", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {n.title || "Sem título"}
                        </span>
                      </button>
                    ))}
                    {dayTasks.map((t) => {
                      const overdue = !t.completed && new Date(t.dueDate) < startOfToday;
                      return (
                        <button key={t.id} onClick={handleTaskClick} style={dayItemStyle}>
                          {overdue ? (
                            <AlertTriangle size={14} style={{ color: "#cf222e", flexShrink: 0 }} />
                          ) : (
                            <CheckSquare size={14} style={{ color: t.completed ? "var(--color-text-muted)" : "var(--color-badge-blue)", flexShrink: 0 }} />
                          )}
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              textDecoration: t.completed ? "line-through" : "none",
                              color: t.completed ? "var(--color-text-muted)" : undefined,
                            }}
                          >
                            {t.title}
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const dayItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 10px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 13,
  borderRadius: 6,
};

export default CalendarView;
