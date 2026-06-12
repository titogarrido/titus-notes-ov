import React from "react";
import { Mic, X } from "lucide-react";
import { AppProvider, useApp } from "./context/AppContext";
import { Sidebar } from "./components/Sidebar";
import { SearchModal } from "./components/SearchModal";
import { Dashboard } from "./views/Dashboard";
import { CalendarView } from "./views/CalendarView";
import { TasksView } from "./views/TasksView";
import { OrganogramaView } from "./views/OrganogramaView";
import { PeopleView } from "./views/PeopleView";
import { ProjectsView } from "./views/ProjectsView";
import { NotesView } from "./views/NotesView";
import { SettingsView } from "./views/SettingsView";
import "./App.css";

// Banner flutuante: um app de reunião (Teams, Zoom, Meet…) começou a usar o
// microfone — oferece criar uma nota e gravar. Some sozinho quando a reunião
// termina (evento meeting-ended) ou ao dispensar.
const MeetingBanner: React.FC = () => {
  const { meetingPrompt, acceptMeetingRecording, dismissMeetingPrompt } = useApp();
  if (!meetingPrompt) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 14px",
        background: "white",
        border: "1px solid #e0e0e0",
        borderLeft: "4px solid #dc2626",
        borderRadius: "10px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
        maxWidth: "420px",
      }}
    >
      <Mic size={18} style={{ color: "#dc2626", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700 }}>Reunião detectada</div>
        <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
          {meetingPrompt.appName} está usando o microfone. Gravar a reunião numa nova nota?
        </div>
      </div>
      <button
        type="button"
        onClick={() => void acceptMeetingRecording()}
        style={{
          padding: "6px 12px",
          border: "none",
          borderRadius: "6px",
          background: "#dc2626",
          color: "white",
          fontSize: "12px",
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Gravar
      </button>
      <button
        type="button"
        onClick={dismissMeetingPrompt}
        title="Agora não"
        style={{
          padding: "4px",
          border: "none",
          background: "transparent",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          display: "flex",
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
};

const MainLayout: React.FC = () => {
  const { currentView, loading } = useApp();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100vw",
          height: "100vh",
          backgroundColor: "#f8f7f4",
          color: "#37352f",
          fontFamily: "var(--font-sans)",
          gap: "16px",
        }}
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            border: "3px solid #e9e9e6",
            borderTopColor: "#df6a16",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-muted)" }}>
          Carregando seu workspace offline...
        </span>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Resolve current active view component
  const renderView = () => {
    switch (currentView) {
      case "painel":
        return <Dashboard />;
      case "calendario":
        return <CalendarView />;
      case "tarefas":
        return <TasksView />;
      case "organograma":
        return <OrganogramaView />;
      case "pessoas":
        return <PeopleView />;
      case "projetos":
        return <ProjectsView />;
      case "notas":
        return <NotesView />;
      case "configuracoes":
        return <SettingsView />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <Sidebar />

      {/* Main content wrapper */}
      <main className="main-content">{renderView()}</main>

      {/* Spotlight Global Search Modal overlay */}
      <SearchModal />

      {/* Reunião detectada — oferta de gravação */}
      <MeetingBanner />
    </div>
  );
};

function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}

export default App;
