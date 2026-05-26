import React from "react";
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
