import React, { useState } from "react";
import { exit } from "@tauri-apps/plugin-process";
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
import { ConfirmDialog } from "./ConfirmDialog";

export const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, addNote, setSelectedEntityId, setSearchOpen, db } = useApp();
  const [confirmQuit, setConfirmQuit] = useState(false);

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
        {/* Workspace info — abre o perfil em Configurações */}
        <div
          className="workspace-profile"
          onClick={() => handleNavClick("configuracoes")}
          title="Abrir configurações do perfil"
        >
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
          <Settings size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
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
        <button className="nav-item" onClick={() => setConfirmQuit(true)}>
          <LogOut className="nav-icon" />
          <span>Sair</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmQuit}
        title="Sair do Titus Notes?"
        message="O aplicativo será encerrado. Suas alterações já foram salvas automaticamente."
        confirmLabel="Sair"
        onConfirm={() => {
          void exit(0);
        }}
        onCancel={() => setConfirmQuit(false)}
      />
    </aside>
  );
};
