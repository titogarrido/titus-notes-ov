import React, { useEffect, useRef, useState } from "react";
import { exit } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
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
  Mic,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { toDateOnly } from "../lib/dates";
import { formatElapsed, RecordingStatus } from "../lib/recording";

function RecordingIndicator({ recording }: { recording: RecordingStatus }) {
  const { db, openNote } = useApp();
  const [elapsed, setElapsed] = useState(recording.elapsedSecs);

  useEffect(() => {
    const startedAt = Date.now() - recording.elapsedSecs * 1000;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [recording.elapsedSecs]);

  const note = db.notes.find((item) => item.id === recording.noteId);
  return (
    <button
      className="sidebar-recording"
      onClick={() => openNote(recording.noteId, "transcript")}
      disabled={!note}
      title={recording.warning ?? "Abrir nota da gravação"}
    >
      <span className="sidebar-recording-heading"><Mic size={14} /> Gravando <span>{formatElapsed(elapsed)}</span></span>
      <span className="sidebar-recording-note">{note?.title || "Gravação de reunião"}</span>
      {!recording.systemAudio && <span className="sidebar-recording-note">Sem áudio do sistema</span>}
    </button>
  );
}

export const Sidebar: React.FC = () => {
  const {
    currentView, setCurrentView, addNote, setSelectedEntityId,
    setSearchOpen, db, openNote, activeRecording, prepareToExit,
  } = useApp();
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [quitBusy, setQuitBusy] = useState(false);
  const [quitError, setQuitError] = useState<string | null>(null);
  const quitBusyRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen("quit-requested", () => setConfirmQuit(true)).then((release) => {
      if (disposed) release();
      else unlisten = release;
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleQuit = async () => {
    if (quitBusyRef.current) return;
    quitBusyRef.current = true;
    setQuitBusy(true);
    setQuitError(null);
    try {
      await prepareToExit();
      await exit(0);
    } catch (error: unknown) {
      setQuitError(error instanceof Error ? error.message : String(error));
    } finally {
      quitBusyRef.current = false;
      setQuitBusy(false);
    }
  };

  const profileName = db.profile?.name?.trim() || "Unnamed";
  const profileAvatar = db.profile?.avatarUrl?.trim() || null;
  const initials = profileName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");

  const handleNewNote = async () => {
    const newNoteId = await addNote({
      title: "Nova Nota",
      content: "",
      date: toDateOnly(),
      projectId: null,
      peopleIds: [],
    });
    openNote(newNoteId);
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
        {activeRecording && <RecordingIndicator key={activeRecording.filename} recording={activeRecording} />}
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
        message={
          quitError ? <span role="alert">Não foi possível sair com segurança. {quitError}</span>
            : activeRecording ? "A gravação atual será finalizada e salva antes de encerrar."
            : "As alterações pendentes serão salvas antes de encerrar."
        }
        confirmLabel={quitBusy ? "Finalizando…" : quitError ? "Tentar novamente" : "Salvar e sair"}
        busy={quitBusy}
        onConfirm={() => void handleQuit()}
        onCancel={() => {
          setConfirmQuit(false);
          setQuitError(null);
        }}
      />
    </aside>
  );
};
