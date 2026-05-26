import React from "react";
import { useApp } from "../context/AppContext";
import {
  LayoutDashboard,
  Calendar,
  CheckSquare,
  Network,
  Users,
  FolderKanban,
  FileText,
  Settings,
  LogOut,
  Plus,
  Search,
} from "lucide-react";

export const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, addNote, setSelectedEntityId, setSearchOpen, db } = useApp();

  const profileName = db.profile?.name?.trim() || "Unnamed";
  const profileAvatar = db.profile?.avatarUrl?.trim() || null;
  const initials = profileName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

  const handleNewNote = async () => {
    const newNoteId = await addNote({
      title: "Sem título",
      content: "# Sem título\n\nComece a digitar aqui...",
      date: new Date().toISOString().split("T")[0],
      projectId: null,
      peopleIds: [],
    });
    setSelectedEntityId(newNoteId);
    setCurrentView("notas");
  };

  const navItems = [
    { id: "painel", label: "Painel", icon: LayoutDashboard },
    { id: "calendario", label: "Calendário", icon: Calendar },
    { id: "tarefas", label: "Tarefas", icon: CheckSquare },
    { id: "organograma", label: "Organograma", icon: Network },
    { id: "pessoas", label: "Pessoas", icon: Users },
    { id: "projetos", label: "Projetos", icon: FolderKanban },
    { id: "notas", label: "Notas", icon: FileText },
  ];

  const handleNavClick = (viewId: string) => {
    setSelectedEntityId(null);
    setCurrentView(viewId);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        {/* Workspace info */}
        <div className="workspace-profile" onClick={() => handleNavClick("painel")}>
          {profileAvatar ? (
            <img src={profileAvatar} alt={profileName} className="workspace-avatar" />
          ) : (
            <div
              className="workspace-avatar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--color-accent, #4f6ef7)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initials || "?"}
            </div>
          )}
          <div className="workspace-info">
            <span className="workspace-user-name">{profileName}</span>
            <span className="workspace-label">WORKSPACE</span>
          </div>
          <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>▼</span>
        </div>

        {/* Action Button */}
        <div className="sidebar-actions">
          <button className="new-note-btn" onClick={handleNewNote}>
            <Plus size={16} />
            <span>Nova Nota</span>
          </button>

          {/* Search Trigger */}
          <div className="search-bar" onClick={() => setSearchOpen(true)}>
            <Search size={14} />
            <span className="search-text">Buscar</span>
            <span className="search-shortcut">⌘K</span>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? "active" : ""}`}
                onClick={() => handleNavClick(item.id)}
              >
                <Icon className="nav-icon" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Actions */}
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${currentView === "configuracoes" ? "active" : ""}`}
          onClick={() => handleNavClick("configuracoes")}
        >
          <Settings className="nav-icon" />
          <span>Configurações</span>
        </button>
        <button className="nav-item" onClick={() => alert(`Até logo, ${profileName}!`)}>
          <LogOut className="nav-icon" />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
};
