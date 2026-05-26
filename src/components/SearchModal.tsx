import React, { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { Search, FileText, FolderKanban, Users, CheckSquare, X } from "lucide-react";

export const SearchModal: React.FC = () => {
  const { db, searchOpen, setSearchOpen, setCurrentView, setSelectedEntityId } = useApp();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    }
  }, [searchOpen]);

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
          p.description.toLowerCase().includes(cleanQuery)
      )
    : [];

  const filteredNotes = cleanQuery
    ? db.notes.filter(
        (n) =>
          n.title.toLowerCase().includes(cleanQuery) ||
          n.content.toLowerCase().includes(cleanQuery)
      )
    : [];

  const filteredTasks = cleanQuery
    ? db.tasks.filter((t) => t.title.toLowerCase().includes(cleanQuery))
    : [];

  const hasResults =
    filteredPeople.length > 0 ||
    filteredProjects.length > 0 ||
    filteredNotes.length > 0 ||
    filteredTasks.length > 0;

  const handleSelect = (view: string, id: string | null) => {
    setSelectedEntityId(id);
    setCurrentView(view);
    setSearchOpen(false);
  };

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
            placeholder="Pesquisar notas, pessoas, projetos e tarefas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  className="search-result-item"
                  onClick={() => handleSelect("notas", note.id)}
                >
                  <FileText size={14} className="search-result-icon" />
                  <span className="search-result-title">{note.title}</span>
                  <span className="search-result-subtitle">{note.date}</span>
                </button>
              ))}
            </div>
          )}

          {filteredProjects.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div className="search-result-group-title">Projetos</div>
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  className="search-result-item"
                  onClick={() => handleSelect("projetos", project.id)}
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
              {filteredPeople.map((person) => (
                <button
                  key={person.id}
                  className="search-result-item"
                  onClick={() => handleSelect("pessoas", person.id)}
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
              {filteredTasks.map((task) => (
                <button
                  key={task.id}
                  className="search-result-item"
                  onClick={() => handleSelect("tarefas", null)}
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
      </div>
    </div>
  );
};
