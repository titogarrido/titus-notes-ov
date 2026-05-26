import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import {
  Settings,
  Database as DbIcon,
  Info,
  FolderOpen,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  X,
  GripVertical,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  ArchiveRestore,
  Loader2,
  UserCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save as dialogSave, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { OllamaSettings, SummaryTemplate, ImportedHyprnoteSession, UserProfile } from "../types";
import { pingOllama } from "../lib/ollama";
import { buildImportReport, ImportReport } from "../lib/hyprnoteImport";

const DEFAULT_SETTINGS: OllamaSettings = {
  url: "http://localhost:11434",
  model: "llama3.2",
  language: "pt-BR",
};

export const SettingsView: React.FC = () => {
  const {
    db,
    updateSettings,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    setHyprnotePath,
    upsertNotes,
    reloadDb,
    updateProfile,
    dataRoot,
    setDataRoot,
  } = useApp();

  const settings = db.settings || DEFAULT_SETTINGS;
  const templates = db.templates || [];

  // ---- Profile ----
  const [profileName, setProfileName] = useState(db.profile?.name || "");
  const [profileAvatar, setProfileAvatar] = useState(db.profile?.avatarUrl || "");
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfileName(db.profile?.name || "");
    setProfileAvatar(db.profile?.avatarUrl || "");
  }, [db.profile?.name, db.profile?.avatarUrl]);

  const handleSaveProfile = async () => {
    const profile: UserProfile = {
      name: profileName.trim(),
      avatarUrl: profileAvatar.trim() || undefined,
    };
    await updateProfile(profile);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 1500);
  };

  // Form local controlado para Ollama
  const [url, setUrl] = useState(settings.url);
  const [model, setModel] = useState(settings.model);
  const [language, setLanguage] = useState(settings.language || "pt-BR");
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    setUrl(settings.url);
    setModel(settings.model);
    setLanguage(settings.language || "pt-BR");
  }, [settings.url, settings.model, settings.language]);

  // Conexão / modelos disponíveis
  const [connStatus, setConnStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; models: string[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const handleSaveSettings = async () => {
    await updateSettings({ url: url.trim(), model: model.trim(), language });
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 1500);
  };

  const handleTestConnection = async () => {
    setConnStatus({ kind: "loading" });
    try {
      const models = await pingOllama({ url: url.trim(), model, language });
      setConnStatus({ kind: "ok", models });
    } catch (e: any) {
      setConnStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  // Template editor modal
  const [editing, setEditing] = useState<SummaryTemplate | "new" | null>(null);
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState<string | null>(null);
  const pendingDeleteTpl = pendingDeleteTemplateId
    ? templates.find((t) => t.id === pendingDeleteTemplateId)
    : null;

  const handleSaveTemplate = async (tpl: Omit<SummaryTemplate, "id"> & { id?: string }) => {
    if (tpl.id) {
      await updateTemplate(tpl as SummaryTemplate);
    } else {
      await addTemplate(tpl);
    }
    setEditing(null);
  };

  // ---- Hyprnote import ----
  const [hyprPath, setHyprPath] = useState(db.hyprnotePath || "");
  const [hyprSaved, setHyprSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setHyprPath(db.hyprnotePath || "");
  }, [db.hyprnotePath]);

  const handleSaveHyprPath = async () => {
    await setHyprnotePath(hyprPath.trim());
    setHyprSaved(true);
    setTimeout(() => setHyprSaved(false), 1500);
  };

  const [importLogPath, setImportLogPath] = useState<string | null>(null);

  const handleImportHyprnote = async () => {
    setImportError(null);
    setImportReport(null);
    setImportLogPath(null);
    setImporting(true);
    const tsStart = new Date();
    try {
      const path = hyprPath.trim();
      if (!path) throw new Error("Configure o caminho antes de importar.");
      // Garante que o path está salvo antes
      if (path !== (db.hyprnotePath || "")) {
        await setHyprnotePath(path);
      }
      const sessions = await invoke<ImportedHyprnoteSession[]>(
        "scan_hyprnote_sessions",
        { path },
      );
      const report = buildImportReport(sessions, db.notes, path);

      // Copia os áudios para files/audio/ antes de salvar as notas.
      // Se a cópia falhar pra um item, removemos audioFile pra não criar
      // referência quebrada — e logamos no import.log.
      const audioErrors: string[] = [];
      if (report.pendingAudioCopies.length > 0) {
        const noteById = new Map(report.notes.map((n) => [n.id, n]));
        for (const job of report.pendingAudioCopies) {
          try {
            await invoke<string>("import_audio_file", {
              sourcePath: job.sourcePath,
              destFilename: job.destFilename,
            });
          } catch (err: any) {
            const msg = err?.message || String(err);
            audioErrors.push(`[${job.noteId}] áudio: ${msg}`);
            const n = noteById.get(job.noteId);
            if (n) n.audioFile = "";
          }
        }
      }
      if (audioErrors.length > 0) {
        report.log +=
          `\n--- Falhas ao copiar áudio (${audioErrors.length}) ---\n` +
          audioErrors.map((l) => `  ${l}`).join("\n");
      }

      if (report.notes.length > 0) {
        await upsertNotes(report.notes);
      }
      // Persiste o log (sempre sobrescreve)
      try {
        const wrote = await invoke<string>("write_import_log", { content: report.log });
        setImportLogPath(wrote);
      } catch (logErr) {
        console.error("Falha ao gravar import.log:", logErr);
      }
      setImportReport(report);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setImportError(msg);
      // Mesmo em erro, tenta gravar o log com o que aconteceu
      try {
        const errLog =
          `[${tsStart.toISOString()}] === Importação Hyprnote ===\n` +
          `[${new Date().toISOString()}] ERROR ${msg}\n`;
        const wrote = await invoke<string>("write_import_log", { content: errLog });
        setImportLogPath(wrote);
      } catch {
        /* ignore */
      }
    } finally {
      setImporting(false);
    }
  };

  const handleRevealImportLog = async () => {
    try {
      let target = importLogPath;
      if (!target) {
        const dir = await invoke<string>("get_db_dir");
        target = `${dir}/import.log`;
      }
      await revealItemInDir(target);
    } catch (e) {
      console.error("Falha ao abrir log:", e);
    }
  };

  // ---- Backup / Restore ----
  const [backupStatus, setBackupStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; path: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [restoreStatus, setRestoreStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestorePath, setPendingRestorePath] = useState<string | null>(null);

  const handleBackup = async () => {
    setBackupStatus({ kind: "loading" });
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dest = await dialogSave({
        defaultPath: `titus-notes-backup-${today}.zip`,
        filters: [{ name: "Backup", extensions: ["zip"] }],
      });
      if (!dest) {
        setBackupStatus({ kind: "idle" });
        return;
      }
      await invoke("create_backup", { destPath: dest });
      setBackupStatus({ kind: "ok", path: dest });
    } catch (e: any) {
      setBackupStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  const handleRestorePick = async () => {
    const path = await dialogOpen({
      filters: [{ name: "Backup", extensions: ["zip"] }],
      multiple: false,
    });
    if (!path || Array.isArray(path)) return;
    setPendingRestorePath(path);
    setRestoreConfirmOpen(true);
  };

  const handleRestoreConfirm = async () => {
    if (!pendingRestorePath) return;
    setRestoreConfirmOpen(false);
    setRestoreStatus({ kind: "loading" });
    try {
      await invoke("restore_backup", { backupPath: pendingRestorePath });
      await reloadDb();
      setRestoreStatus({ kind: "ok" });
    } catch (e: any) {
      setRestoreStatus({ kind: "error", message: e?.message || String(e) });
    } finally {
      setPendingRestorePath(null);
    }
  };

  const handleRevealInFinder = async () => {
    try {
      const dir = await invoke<string>("get_db_dir");
      await revealItemInDir(dir + "/db.json");
    } catch (err) {
      console.error("Failed to reveal in Finder:", err);
    }
  };

  // ---- Data root (custom DB location) ----
  const [dataRootStatus, setDataRootStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; info: { current: string; isCustom: boolean } }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pendingNewRoot, setPendingNewRoot] = useState<string | null>(null);
  const [rootMigrate, setRootMigrate] = useState<boolean>(true);
  const [rootConfirmOpen, setRootConfirmOpen] = useState(false);
  const [resetRootConfirmOpen, setResetRootConfirmOpen] = useState(false);

  const handlePickDataRoot = async () => {
    const picked = await dialogOpen({
      directory: true,
      multiple: false,
      title: "Escolher pasta para o banco de dados",
    });
    if (!picked || Array.isArray(picked)) return;
    setPendingNewRoot(picked);
    setRootMigrate(true);
    setRootConfirmOpen(true);
  };

  const handleConfirmChangeRoot = async () => {
    if (!pendingNewRoot) return;
    setRootConfirmOpen(false);
    setDataRootStatus({ kind: "loading" });
    try {
      const info = await setDataRoot(pendingNewRoot, rootMigrate);
      setDataRootStatus({ kind: "ok", info });
      setTimeout(() => setDataRootStatus({ kind: "idle" }), 2500);
    } catch (e: any) {
      setDataRootStatus({ kind: "error", message: e?.message || String(e) });
    } finally {
      setPendingNewRoot(null);
    }
  };

  const handleConfirmResetRoot = async () => {
    setResetRootConfirmOpen(false);
    setDataRootStatus({ kind: "loading" });
    try {
      const info = await setDataRoot(null, false);
      setDataRootStatus({ kind: "ok", info });
      setTimeout(() => setDataRootStatus({ kind: "idle" }), 2500);
    } catch (e: any) {
      setDataRootStatus({ kind: "error", message: e?.message || String(e) });
    }
  };

  return (
    <div className="view-container" style={{ maxWidth: "880px" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 className="detail-title" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Settings size={24} />
          <span>Configurações</span>
        </h1>
        <p className="welcome-subtitle" style={{ marginTop: "4px" }}>
          IA, banco de dados e backups.
        </p>
      </div>

      <div className="settings-box">
        {/* Profile */}
        <div className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <UserCircle size={16} />
            <span>Perfil</span>
          </h2>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
            {profileAvatar.trim() ? (
              <img
                src={profileAvatar.trim()}
                alt={profileName || "Unnamed"}
                style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid var(--border-color)" }}
              />
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
                background: "var(--color-accent, #4f6ef7)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "18px", fontWeight: 700,
              }}>
                {(profileName.trim() || "U")
                  .split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() || "").join("") || "?"}
              </div>
            )}
            <div style={{ fontSize: "13px" }}>
              <div style={{ fontWeight: 600 }}>{profileName.trim() || "Unnamed"}</div>
              <div style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>Exibido na barra lateral</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Nome
              <input
                type="text"
                className="form-input"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Unnamed"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              URL do avatar (opcional)
              <input
                type="text"
                className="form-input"
                value={profileAvatar}
                onChange={(e) => setProfileAvatar(e.target.value)}
                placeholder="https://..."
                spellCheck={false}
              />
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px" }}>
            <button className="btn-primary" onClick={handleSaveProfile}>
              Salvar
            </button>
            {profileSaved && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
          </div>
        </div>

        {/* Ollama */}
        <div className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Sparkles size={16} />
            <span>Integração Ollama</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "16px" }}>
            Configure o servidor Ollama local. O sumário das notas é gerado usando o modelo abaixo.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              URL
              <input
                type="text"
                className="form-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Modelo
              <input
                type="text"
                className="form-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3.2"
                list="ollama-models"
              />
              {connStatus.kind === "ok" && connStatus.models.length > 0 && (
                <datalist id="ollama-models">
                  {connStatus.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
              Idioma das gerações
              <select
                className="form-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="pt">Português</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
              </select>
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={handleSaveSettings}>
              Salvar
            </button>
            <button className="btn-secondary" onClick={handleTestConnection}>
              {connStatus.kind === "loading" ? "Testando..." : "Testar conexão"}
            </button>
            {savedHint && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
            {connStatus.kind === "ok" && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Conectado · {connStatus.models.length} modelo(s)
              </span>
            )}
            {connStatus.kind === "error" && (
              <span style={{ fontSize: "12px", color: "#cf222e", display: "flex", alignItems: "center", gap: "4px" }}>
                <AlertCircle size={14} /> {connStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Templates de sumário */}
        <div className="settings-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <h2 className="section-title" style={{ fontSize: "15px", margin: 0 }}>
              <Sparkles size={16} />
              <span>Templates de Sumário</span>
            </h2>
            <button
              className="btn-secondary"
              onClick={() => setEditing("new")}
              style={{ display: "flex", alignItems: "center", gap: "4px" }}
            >
              <Plus size={14} />
              <span>Novo template</span>
            </button>
          </div>

          {templates.length === 0 ? (
            <p style={{ fontSize: "12px", color: "var(--color-text-muted)", fontStyle: "italic" }}>
              Nenhum template cadastrado. Crie um para gerar sumários personalizados nas suas notas.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{tpl.name}</div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      {tpl.description || "Sem descrição"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: 4 }}>
                      {tpl.sections.length} seção(ões): {tpl.sections.join(" · ")}
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => setEditing(tpl)}
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => setPendingDeleteTemplateId(tpl.id)}
                    title="Excluir"
                    style={{ color: "#cf222e" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hyprnote import */}
        <div className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Download size={16} />
            <span>Importação · Hyprnote (analog)</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "14px" }}>
            Aponte para a pasta <code>sessions/</code> do hyprnote. As notas serão importadas
            usando o id de cada sessão — importações repetidas atualizam ao invés de duplicar.
          </p>

          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--color-text-muted)" }}>
            Caminho da pasta sessions
            <input
              type="text"
              className="form-input"
              value={hyprPath}
              onChange={(e) => setHyprPath(e.target.value)}
              placeholder="/Users/<usuario>/Library/Application Support/hyprnote/sessions/"
              spellCheck={false}
              style={{ fontFamily: "monospace", fontSize: "12px" }}
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={handleSaveHyprPath}>
              Salvar caminho
            </button>
            <button
              className="btn-primary"
              onClick={handleImportHyprnote}
              disabled={importing || !hyprPath.trim()}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              {importing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              <span>{importing ? "Importando..." : "Importar agora"}</span>
            </button>
            {hyprSaved && (
              <span style={{ fontSize: "12px", color: "#1f8e3d", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={14} /> Salvo
              </span>
            )}
            <button
              className="btn-secondary"
              onClick={handleRevealImportLog}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
              title="Abrir import.log no Finder"
            >
              <FolderOpen size={14} />
              <span>Ver log</span>
            </button>
          </div>

          {importError && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 14px",
                border: "1px solid #f5c2c7",
                background: "#f8d7da",
                color: "#842029",
                borderRadius: "8px",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <AlertCircle size={14} /> {importError}
            </div>
          )}

          {importReport && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px 14px",
                border: "1px solid #b6e0c2",
                background: "#e6f7ec",
                color: "#1f6f3d",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <CheckCircle2 size={14} />
                <strong>Importação concluída.</strong>
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <span>Total: <strong>{importReport.total}</strong></span>
                <span>Novas: <strong>{importReport.created}</strong></span>
                <span>Atualizadas: <strong>{importReport.updated}</strong></span>
                {importReport.skipped > 0 && <span>Ignoradas: {importReport.skipped}</span>}
                {importReport.pendingAudioCopies.length > 0 && (
                  <span>Áudios: <strong>{importReport.pendingAudioCopies.length}</strong></span>
                )}
                {importReport.errors.length > 0 && <span>Erros: {importReport.errors.length}</span>}
              </div>
              {importReport.errors.length > 0 && (
                <ul style={{ marginTop: "8px", paddingLeft: "18px" }}>
                  {importReport.errors.slice(0, 5).map((e, i) => (
                    <li key={i} style={{ color: "#842029" }}>
                      <code>{e.folder}</code>: {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* About */}
        <div className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <Info size={16} />
            <span>Sobre o Titus Notes</span>
          </h2>
          <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--color-text-muted)" }}>
            O <strong>Titus Notes</strong> é um organizador pessoal e gerenciador de reuniões profissional, autocontido, mono-usuário e 100% offline.
            Versão <strong>0.1.0</strong>. Desenvolvido com <strong>Tauri v2 + Rust</strong> e interface <strong>React</strong>.
          </p>
        </div>

        {/* Database Info */}
        <div className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "16px" }}>
            <DbIcon size={16} />
            <span>Banco de Dados Local</span>
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
            <div className="settings-row" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
              <div className="settings-text-block" style={{ minWidth: 0, flex: 1 }}>
                <span className="settings-title">
                  Localização dos arquivos{dataRoot?.isCustom && " (personalizada)"}:
                </span>
                <span style={{ fontFamily: "monospace", fontSize: "11px", background: "var(--bg-sidebar)", padding: "4px 8px", borderRadius: "4px", wordBreak: "break-all" }}>
                  {dataRoot?.current ? `${dataRoot.current}/db.json` : "—"}
                </span>
                {dataRoot?.isCustom && (
                  <span className="settings-desc" style={{ marginTop: 4 }}>
                    Padrão: <code style={{ fontSize: 11 }}>{dataRoot.default}</code>
                  </span>
                )}
              </div>
              <button className="btn-secondary" onClick={handleRevealInFinder} style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                <FolderOpen size={14} />
                <span>Ver no Finder</span>
              </button>
            </div>

            <div className="settings-row" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
              <div className="settings-text-block">
                <span className="settings-title">Alterar pasta</span>
                <span className="settings-desc">
                  Escolha uma pasta personalizada (ex: iCloud, Dropbox) para armazenar o banco e os arquivos.
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {dataRoot?.isCustom && (
                  <button
                    className="btn-secondary"
                    onClick={() => setResetRootConfirmOpen(true)}
                    disabled={dataRootStatus.kind === "loading"}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Restaurar padrão
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={handlePickDataRoot}
                  disabled={dataRootStatus.kind === "loading"}
                  style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
                >
                  {dataRootStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
                  <span>{dataRootStatus.kind === "loading" ? "Aplicando..." : "Escolher pasta..."}</span>
                </button>
              </div>
            </div>

            {dataRootStatus.kind === "ok" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d" }}>
                <CheckCircle2 size={14} /> Pasta atualizada: <code style={{ fontSize: 11 }}>{dataRootStatus.info.current}</code>
              </div>
            )}
            {dataRootStatus.kind === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e" }}>
                <AlertCircle size={14} /> {dataRootStatus.message}
              </div>
            )}

            <div className="settings-row" style={{ paddingTop: "6px" }}>
              <div className="settings-text-block">
                <span className="settings-title">Métricas de Uso</span>
                <span className="settings-desc">Estatísticas de entidades salvas localmente</span>
              </div>
              <div style={{ display: "flex", gap: "16px", fontWeight: 600 }}>
                <span>{db.people.length} Pessoas</span>
                <span>{db.projects.length} Projetos</span>
                <span>{db.notes.length} Notas</span>
                <span>{db.tasks.length} Tarefas</span>
              </div>
            </div>
          </div>
        </div>

        {/* Backup & Restore */}
        <div className="settings-card">
          <h2 className="section-title" style={{ fontSize: "15px", marginBottom: "12px" }}>
            <ArchiveRestore size={16} />
            <span>Backup e Restauração</span>
          </h2>
          <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "16px" }}>
            O backup inclui o banco de dados e todos os arquivos (imagens e áudios). A restauração sobrescreve os dados locais.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="settings-row">
              <div className="settings-text-block">
                <span className="settings-title">Criar Backup</span>
                <span className="settings-desc">Exporta todos os dados para um arquivo .zip</span>
              </div>
              <button
                className="btn-primary"
                onClick={handleBackup}
                disabled={backupStatus.kind === "loading"}
                style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
              >
                {backupStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                <span>{backupStatus.kind === "loading" ? "Salvando..." : "Fazer Backup"}</span>
              </button>
            </div>

            {backupStatus.kind === "ok" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d" }}>
                <CheckCircle2 size={14} />
                <span>Backup salvo em <code style={{ fontSize: "11px" }}>{backupStatus.path}</code></span>
              </div>
            )}
            {backupStatus.kind === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e" }}>
                <AlertCircle size={14} /> {backupStatus.message}
              </div>
            )}

            <div className="settings-row" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "12px" }}>
              <div className="settings-text-block">
                <span className="settings-title">Restaurar Backup</span>
                <span className="settings-desc">Importa um arquivo .zip e substitui os dados atuais</span>
              </div>
              <button
                className="btn-secondary"
                onClick={handleRestorePick}
                disabled={restoreStatus.kind === "loading"}
                style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
              >
                {restoreStatus.kind === "loading" ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                <span>{restoreStatus.kind === "loading" ? "Restaurando..." : "Restaurar"}</span>
              </button>
            </div>

            {restoreStatus.kind === "ok" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#1f8e3d" }}>
                <CheckCircle2 size={14} /> Backup restaurado com sucesso.
              </div>
            )}
            {restoreStatus.kind === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#cf222e" }}>
                <AlertCircle size={14} /> {restoreStatus.message}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Template editor modal */}
      {editing && (
        <TemplateEditorModal
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={handleSaveTemplate}
        />
      )}

      <ConfirmDialog
        open={!!pendingDeleteTpl}
        title="Excluir template?"
        message={
          <>
            O template <strong>{pendingDeleteTpl?.name || ""}</strong> será removido. Sumários já gerados continuam existindo nas notas.
          </>
        }
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (pendingDeleteTemplateId) {
            const id = pendingDeleteTemplateId;
            setPendingDeleteTemplateId(null);
            await deleteTemplate(id);
          }
        }}
        onCancel={() => setPendingDeleteTemplateId(null)}
      />

      <style>{`
        .spin { animation: spinAnim 1s linear infinite; }
        @keyframes spinAnim { to { transform: rotate(360deg); } }
      `}</style>

      <ConfirmDialog
        open={rootConfirmOpen}
        title="Alterar pasta do banco de dados?"
        message={
          <>
            Nova pasta:
            {pendingNewRoot && (
              <div style={{ marginTop: 6, marginBottom: 10, fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-muted)", wordBreak: "break-all" }}>
                {pendingNewRoot}
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={rootMigrate}
                onChange={(e) => setRootMigrate(e.target.checked)}
              />
              <span>Copiar dados atuais (<code>db.json</code> + <code>files/</code>) para a nova pasta</span>
            </label>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
              {rootMigrate
                ? "Se a nova pasta já tiver db.json, ele será sobrescrito."
                : "Os dados atuais permanecem na pasta anterior. Se a nova pasta estiver vazia, dados padrão serão recriados."}
            </div>
          </>
        }
        confirmLabel="Aplicar"
        onConfirm={handleConfirmChangeRoot}
        onCancel={() => { setRootConfirmOpen(false); setPendingNewRoot(null); }}
      />

      <ConfirmDialog
        open={resetRootConfirmOpen}
        title="Restaurar pasta padrão?"
        message={
          <>
            O app voltará a usar a pasta padrão. Os dados na pasta personalizada
            <strong> não serão movidos</strong> — copie manualmente se quiser preservá-los.
            {dataRoot?.default && (
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 11, color: "var(--color-text-muted)" }}>
                {dataRoot.default}
              </div>
            )}
          </>
        }
        confirmLabel="Restaurar padrão"
        danger
        onConfirm={handleConfirmResetRoot}
        onCancel={() => setResetRootConfirmOpen(false)}
      />

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="Restaurar backup?"
        message={
          <>
            <strong>Atenção:</strong> os dados atuais (banco de dados e arquivos) serão substituídos pelo conteúdo do backup. Esta ação não pode ser desfeita.
            {pendingRestorePath && (
              <div style={{ marginTop: "8px", fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-muted)" }}>
                {pendingRestorePath}
              </div>
            )}
          </>
        }
        confirmLabel="Restaurar"
        danger
        onConfirm={handleRestoreConfirm}
        onCancel={() => { setRestoreConfirmOpen(false); setPendingRestorePath(null); }}
      />

    </div>
  );
};
export default SettingsView;

// ---------------- Template editor modal ----------------

interface TemplateEditorModalProps {
  initial: SummaryTemplate | null;
  onCancel: () => void;
  onSave: (tpl: Omit<SummaryTemplate, "id"> & { id?: string }) => Promise<void>;
}

const TemplateEditorModal: React.FC<TemplateEditorModalProps> = ({ initial, onCancel, onSave }) => {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [sections, setSections] = useState<string[]>(initial?.sections.length ? initial.sections : [""]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const updateSection = (i: number, v: string) =>
    setSections((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  const removeSection = (i: number) =>
    setSections((arr) => arr.filter((_, idx) => idx !== i));
  const addSection = () => setSections((arr) => [...arr, ""]);
  const moveSection = (from: number, to: number) => {
    setSections((arr) => {
      const next = [...arr];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sections.map((s) => s.trim()).filter(Boolean);
    if (!name.trim() || cleaned.length === 0) return;
    await onSave({
      id: initial?.id,
      name: name.trim(),
      description: description.trim(),
      sections: cleaned,
    });
  };

  // drag and drop simples por índice
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        backdropFilter: "blur(2px)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "12px",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.25)",
          padding: "20px",
          width: "640px",
          maxWidth: "92vw",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
            {initial ? "Editar template" : "Novo template"}
          </h3>
          <button type="button" onClick={onCancel} className="btn-icon" title="Fechar">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>
            NOME DO MODELO
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>
            DESCRIPTION
            <input
              type="text"
              className="form-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Sections
          </span>
          <button
            type="button"
            onClick={addSection}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <Plus size={12} /> Add Section
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {sections.map((s, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== i) moveSection(dragIdx, i);
                setDragIdx(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                background: dragIdx === i ? "#eef4ff" : "white",
              }}
            >
              <GripVertical
                size={14}
                style={{ color: "var(--color-text-muted)", cursor: "grab", flexShrink: 0 }}
              />
              <input
                type="text"
                className="form-input"
                value={s}
                onChange={(e) => updateSection(i, e.target.value)}
                placeholder="Nome da seção"
                style={{ flex: 1, border: "none", padding: "6px 4px" }}
              />
              {sections.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSection(i)}
                  className="btn-icon"
                  style={{ color: "#cf222e" }}
                  title="Remover"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary">
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
};
